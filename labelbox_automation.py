"""
Labelbox Automation Script

Connects to an existing Firefox browser via Marionette protocol and automates labeling workflow:
1. Scrapes image, question, and model answer from current row
2. Calls Claude API for correction
3. Pastes correction into "Correct Answer" textarea
4. Sets classification dropdown if possible
5. Clicks Submit and moves to next row

SETUP:
Firefox must be started with Marionette enabled:
firefox.exe -marionette
"""

import os
import base64
import time
from dotenv import load_dotenv
from marionette_driver.marionette import Marionette
from marionette_driver.by import By
from marionette_driver.wait import Wait
from marionette_driver.errors import NoSuchElementException, TimeoutException
import anthropic

# Load environment variables
load_dotenv()

# Get API key from .env
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY not found in .env file")

# Firefox Marionette port (default is 2828)
MARIONETTE_HOST = os.getenv("MARIONETTE_HOST", "localhost")
MARIONETTE_PORT = int(os.getenv("MARIONETTE_PORT", "2828"))


def get_image_as_base64(client: Marionette, image_selector: str) -> dict:
    """
    Extract image from the page and convert to base64 for Claude API.
    Returns dict with source type and data.
    """
    try:
        # Try to find the image element
        image = client.find_element(By.CSS_SELECTOR, image_selector)

        # Get image src
        src = image.get_attribute("src")

        if src and src.startswith("data:image"):
            # Already base64 encoded
            media_type = src.split(";")[0].split(":")[1]
            base64_data = src.split(",")[1]
            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64_data
                }
            }
        elif src and (src.startswith("http") or src.startswith("/")):
            # Use JavaScript to fetch and convert to base64
            script = """
            const img = arguments[0];
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/png');
            """
            data_url = client.execute_script(script, script_args=[image])

            if data_url and data_url.startswith("data:image"):
                media_type = data_url.split(";")[0].split(":")[1]
                base64_data = data_url.split(",")[1]
                return {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": base64_data
                    }
                }

        return None

    except Exception as e:
        print(f"Error extracting image with selector '{image_selector}': {e}")
        return None


def scrape_current_row(client: Marionette):
    """
    Scrape the current row's image, question, and model answer.
    """
    try:
        # Wait for page to be ready
        time.sleep(1)

        # Try to find the image
        image_selectors = [
            "img.task-image",
            "[data-testid='image']",
            ".image-container img",
            "img[alt*='task']",
            "img[src*='labelbox']",
            "img"  # fallback
        ]

        image_data = None
        for selector in image_selectors:
            try:
                elements = client.find_elements(By.CSS_SELECTOR, selector)
                if elements:
                    image_data = get_image_as_base64(client, selector)
                    if image_data:
                        print(f"✓ Found image with selector: {selector}")
                        break
            except:
                continue

        # Try to find the question text
        question_selectors = [
            "[data-testid='question']",
            ".question-text",
        ]

        question = ""
        for selector in question_selectors:
            try:
                elem = client.find_element(By.CSS_SELECTOR, selector)
                question = elem.text
                if question.strip():
                    print(f"✓ Found question with selector: {selector}")
                    break
            except:
                continue

        # If no question found, try heuristic
        if not question.strip():
            try:
                body_text = client.find_element(By.TAG_NAME, "body").text
                for line in body_text.split("\n"):
                    if "?" in line and len(line) < 500:
                        question = line.strip()
                        print(f"✓ Found question via heuristic")
                        break
            except:
                pass

        # Try to find model answer
        model_answer_selectors = [
            "[data-testid='model-answer']",
            ".model-answer",
            "textarea[readonly]",
        ]

        model_answer = ""
        for selector in model_answer_selectors:
            try:
                elem = client.find_element(By.CSS_SELECTOR, selector)
                model_answer = elem.text or elem.get_attribute("value")
                if model_answer.strip():
                    print(f"✓ Found model answer with selector: {selector}")
                    break
            except:
                continue

        return {
            "image": image_data,
            "question": question.strip(),
            "model_answer": model_answer.strip()
        }

    except Exception as e:
        print(f"Error scraping row: {e}")
        import traceback
        traceback.print_exc()
        return None


def call_claude_api(image_data: dict, question: str, model_answer: str) -> str:
    """
    Call Claude API with the scraped data and return the correction.
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    # Build the prompt
    prompt_parts = []

    if question:
        prompt_parts.append(f"Question: {question}")

    if model_answer:
        prompt_parts.append(f"\nModel's Answer: {model_answer}")

    prompt_parts.append("\nPlease provide the correct answer. Be concise and accurate.")

    prompt = "\n".join(prompt_parts)

    # Build message content
    content = []

    # Add image if available
    if image_data:
        content.append(image_data)

    # Add text prompt
    content.append({
        "type": "text",
        "text": prompt
    })

    try:
        print("Calling Claude API...")
        message = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=1024,
            messages=[
                {
                    "role": "user",
                    "content": content
                }
            ]
        )

        # Extract the text response
        correction = message.content[0].text
        print(f"✓ Got correction from Claude: {correction[:100]}...")
        return correction

    except Exception as e:
        print(f"Error calling Claude API: {e}")
        import traceback
        traceback.print_exc()
        return ""


def submit_correction(client: Marionette, correction: str):
    """
    Paste the correction into the Correct Answer textarea and submit.
    """
    try:
        # Find and fill the "Correct Answer" textarea
        try:
            textarea = client.find_element(By.CSS_SELECTOR, "textarea.css-16l8qav")
        except:
            # Try generic textarea
            textareas = client.find_elements(By.TAG_NAME, "textarea")
            textarea = textareas[-1] if textareas else None

        if not textarea:
            print("⚠ Could not find textarea")
            return False

        # Clear and fill
        textarea.clear()
        textarea.send_keys(correction)
        print("✓ Pasted correction into textarea")

        # Try to set classification dropdown if it exists
        try:
            selects = client.find_elements(By.TAG_NAME, "select")
            if selects:
                # Use JavaScript to select the second option
                script = """
                const select = arguments[0];
                if (select.options.length > 1) {
                    select.selectedIndex = 1;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                """
                client.execute_script(script, script_args=[selects[0]])
                print("✓ Set classification dropdown")
        except Exception as e:
            print(f"Note: Could not set classification dropdown: {e}")

        # Click Submit button
        submit_selectors = [
            "button[type='submit']",
            "input[type='submit']",
        ]

        submit_button = None
        for selector in submit_selectors:
            try:
                submit_button = client.find_element(By.CSS_SELECTOR, selector)
                break
            except:
                continue

        # Try finding by text if selectors fail
        if not submit_button:
            try:
                buttons = client.find_elements(By.TAG_NAME, "button")
                for btn in buttons:
                    if "submit" in btn.text.lower():
                        submit_button = btn
                        break
            except:
                pass

        if submit_button:
            submit_button.click()
            print("✓ Clicked Submit")
            time.sleep(2)
            return True
        else:
            print("⚠ Warning: Could not find Submit button")
            return False

    except Exception as e:
        print(f"Error submitting correction: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """
    Main automation loop.
    """
    print("Starting Labelbox automation...")
    print(f"Connecting to Firefox Marionette at {MARIONETTE_HOST}:{MARIONETTE_PORT}...")

    try:
        # Connect to Firefox via Marionette
        client = Marionette(host=MARIONETTE_HOST, port=MARIONETTE_PORT)
        client.start_session()

        print("✓ Connected to Firefox")

        # Get current URL
        current_url = client.get_url()
        print(f"Current URL: {current_url}")

        # Check if we're on the right page
        if "editor.labelbox.com" not in current_url:
            print("⚠ Warning: Not on editor.labelbox.com - trying to find the right tab...")

            # Try to switch to a window with labelbox
            for handle in client.window_handles:
                client.switch_to_window(handle)
                url = client.get_url()
                if "editor.labelbox.com" in url:
                    print(f"✓ Found Labelbox tab: {url}")
                    break

        # Main automation loop
        iteration = 0
        while True:
            iteration += 1
            print(f"\n{'='*60}")
            print(f"Processing row #{iteration}")
            print(f"{'='*60}")

            # Check if Submit button is still visible
            try:
                buttons = client.find_elements(By.TAG_NAME, "button")
                submit_visible = any("submit" in btn.text.lower() for btn in buttons)
                if not submit_visible:
                    print("✓ Submit button no longer visible. Automation complete!")
                    break
            except:
                pass

            # 1. Scrape current row
            row_data = scrape_current_row(client)
            if not row_data:
                print("⚠ Could not scrape row data. Retrying in 5 seconds...")
                time.sleep(5)
                continue

            print(f"\nScraped data:")
            print(f"  - Image: {'✓' if row_data.get('image') else '✗'}")
            print(f"  - Question: {row_data.get('question', '')[:50]}...")
            print(f"  - Model Answer: {row_data.get('model_answer', '')[:50]}...")

            # 2. Call Claude API
            correction = call_claude_api(
                row_data.get("image"),
                row_data.get("question", ""),
                row_data.get("model_answer", "")
            )

            if not correction:
                print("⚠ No correction received from Claude API. Skipping this row.")
                # Try to click Submit anyway to move to next
                try:
                    buttons = client.find_elements(By.TAG_NAME, "button")
                    for btn in buttons:
                        if "submit" in btn.text.lower():
                            btn.click()
                            time.sleep(2)
                            break
                except:
                    pass
                continue

            # 3. Submit correction
            success = submit_correction(client, correction)

            if not success:
                print("⚠ Failed to submit. Waiting 5 seconds before next attempt...")
                time.sleep(5)

            # Small delay between iterations
            time.sleep(1)

        print("\n" + "="*60)
        print("Automation completed successfully!")
        print("="*60)

    except Exception as e:
        print(f"\nError in main loop: {e}")
        import traceback
        traceback.print_exc()
        print("\nTroubleshooting tips:")
        print("1. Make sure Firefox is started with Marionette enabled:")
        print("   firefox.exe -marionette")
        print("2. Check that you're on editor.labelbox.com")
        print("3. Verify ANTHROPIC_API_KEY is set in .env file")
        print("4. Check that Marionette port 2828 is accessible")
    finally:
        try:
            client.delete_session()
        except:
            pass


if __name__ == "__main__":
    main()

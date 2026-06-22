"""
Labelbox Automation Script

Launches Chrome via Playwright using your existing profile (so you're already logged in),
then automates labeling workflow:
1. Scrapes image, question, and model answer from current row
2. Calls Claude API for correction
3. Pastes correction into "Correct Answer" textarea
4. Sets classification dropdown if possible
5. Clicks Submit and moves to next row

SETUP:
- Just run this script - it will launch Chrome with your profile automatically
- Navigate to editor.labelbox.com if not already there
"""

import asyncio
import os
import base64
from pathlib import Path
from dotenv import load_dotenv
from playwright.async_api import async_playwright
import anthropic

# Load environment variables
load_dotenv()

# Get API key from .env
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY not found in .env file")

# Chrome user data directory - using Default profile
CHROME_USER_DATA = os.getenv(
    "CHROME_USER_DATA",
    r"C:\Users\Alexander\AppData\Local\Google\Chrome\User Data"
)


async def get_image_as_base64(page, image_selector: str) -> dict:
    """
    Extract image from the page and convert to base64 for Claude API.
    Returns dict with source type and data.
    """
    try:
        # Wait for image to be loaded
        await page.wait_for_selector(image_selector, timeout=5000)

        # Get image element
        image = page.locator(image_selector).first

        # Get image src or srcset
        src = await image.get_attribute("src")

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
            # Need to fetch and convert
            response = await page.request.get(src)
            image_bytes = await response.body()
            base64_data = base64.b64encode(image_bytes).decode("utf-8")

            # Determine media type from response headers or URL
            content_type = response.headers.get("content-type", "image/jpeg")

            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": content_type,
                    "data": base64_data
                }
            }
        else:
            # Fallback: take screenshot of the element
            screenshot_bytes = await image.screenshot()
            base64_data = base64.b64encode(screenshot_bytes).decode("utf-8")
            return {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": base64_data
                }
            }
    except Exception as e:
        print(f"Error extracting image: {e}")
        return None


async def scrape_current_row(page):
    """
    Scrape the current row's image, question, and model answer.
    You'll need to adjust selectors based on actual Labelbox DOM structure.
    """
    try:
        # Wait for the page to be ready
        await page.wait_for_load_state("networkidle")

        # These are example selectors - adjust based on actual Labelbox structure
        # You can use browser DevTools to find the correct selectors

        # Try to find the image (common patterns in labeling tools)
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
                if await page.locator(selector).count() > 0:
                    image_data = await get_image_as_base64(page, selector)
                    if image_data:
                        print(f"✓ Found image with selector: {selector}")
                        break
            except:
                continue

        # Try to find the question text
        question_selectors = [
            "[data-testid='question']",
            ".question-text",
            "label:has-text('Question')",
            "div:has-text('Question') + div",
        ]

        question = ""
        for selector in question_selectors:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    question = await elem.inner_text()
                    if question.strip():
                        print(f"✓ Found question with selector: {selector}")
                        break
            except:
                continue

        # If still no question, try to find any prominent text
        if not question.strip():
            try:
                # Look for any text that looks like a question
                all_text = await page.inner_text("body")
                # Simple heuristic: find text with question mark
                for line in all_text.split("\n"):
                    if "?" in line and len(line) < 500:
                        question = line.strip()
                        print(f"✓ Found question via heuristic: {question[:50]}...")
                        break
            except:
                pass

        # Try to find model answer
        model_answer_selectors = [
            "[data-testid='model-answer']",
            ".model-answer",
            "textarea[readonly]",
            "div:has-text('Model Answer') + div",
            "div:has-text('Answer') + div",
        ]

        model_answer = ""
        for selector in model_answer_selectors:
            try:
                elem = page.locator(selector).first
                if await elem.count() > 0:
                    model_answer = await elem.inner_text()
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


async def call_claude_api(image_data: dict, question: str, model_answer: str) -> str:
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


async def submit_correction(page, correction: str):
    """
    Paste the correction into the Correct Answer textarea and submit.
    """
    try:
        # Find and fill the "Correct Answer" textarea
        correct_answer_textarea = page.locator("textarea.css-16l8qav")

        # Wait for it to be visible
        await correct_answer_textarea.wait_for(state="visible", timeout=5000)

        # Clear and fill
        await correct_answer_textarea.clear()
        await correct_answer_textarea.fill(correction)
        print("✓ Pasted correction into textarea")

        # Try to set classification dropdown if it exists
        try:
            # Look for common dropdown patterns
            dropdown_selectors = [
                "select[name*='classification']",
                "select[name*='category']",
                "[data-testid='classification-dropdown']",
                "select"
            ]

            for selector in dropdown_selectors:
                if await page.locator(selector).count() > 0:
                    # Just select the first non-empty option as a guess
                    options = await page.locator(f"{selector} option").all()
                    if len(options) > 1:
                        # Select second option (first is usually empty/placeholder)
                        await page.select_option(selector, index=1)
                        print("✓ Set classification dropdown")
                        break
        except Exception as e:
            print(f"Note: Could not set classification dropdown: {e}")

        # Click Submit button
        submit_selectors = [
            "button:has-text('Submit')",
            "[data-testid='submit']",
            "button[type='submit']",
            "input[type='submit']"
        ]

        for selector in submit_selectors:
            try:
                if await page.locator(selector).count() > 0:
                    await page.locator(selector).first.click()
                    print("✓ Clicked Submit")
                    # Wait a bit for the next row to load
                    await asyncio.sleep(2)
                    return True
            except:
                continue

        print("⚠ Warning: Could not find Submit button")
        return False

    except Exception as e:
        print(f"Error submitting correction: {e}")
        import traceback
        traceback.print_exc()
        return False


async def main():
    """
    Main automation loop.
    """
    print("Starting Labelbox automation...")
    print(f"Using Chrome profile: {CHROME_USER_DATA}")

    # Verify profile exists
    if not Path(CHROME_USER_DATA).exists():
        print(f"ERROR: Chrome user data directory not found at {CHROME_USER_DATA}")
        return

    async with async_playwright() as p:
        try:
            # Launch Chrome with your existing profile using persistent context
            print("Launching Chrome with your profile (cookies/sessions preserved)...")
            context = await p.chromium.launch_persistent_context(
                user_data_dir=CHROME_USER_DATA,
                headless=False,
                channel="chrome"  # Use system Chrome, not Playwright's bundled Chromium
            )

            print("✓ Chrome launched")

            # Create a new page
            page = await context.new_page()

            # Navigate to Labelbox if not already there
            current_url = page.url
            if "editor.labelbox.com" not in current_url:
                print("\nNavigate to editor.labelbox.com in the browser window...")
                print("Press Enter here once you're on the labeling page...")
                input()

            # Bring the page to front
            await page.bring_to_front()

            # Main automation loop
            iteration = 0
            while True:
                iteration += 1
                print(f"\n{'='*60}")
                print(f"Processing row #{iteration}")
                print(f"{'='*60}")

                # Check if Submit button is still visible
                submit_visible = await page.locator("button:has-text('Submit')").count() > 0
                if not submit_visible:
                    print("✓ Submit button no longer visible. Automation complete!")
                    break

                # 1. Scrape current row
                row_data = await scrape_current_row(page)
                if not row_data:
                    print("⚠ Could not scrape row data. Retrying in 5 seconds...")
                    await asyncio.sleep(5)
                    continue

                print(f"\nScraped data:")
                print(f"  - Image: {'✓' if row_data.get('image') else '✗'}")
                print(f"  - Question: {row_data.get('question', '')[:50]}...")
                print(f"  - Model Answer: {row_data.get('model_answer', '')[:50]}...")

                # 2. Call Claude API
                correction = await call_claude_api(
                    row_data.get("image"),
                    row_data.get("question", ""),
                    row_data.get("model_answer", "")
                )

                if not correction:
                    print("⚠ No correction received from Claude API. Skipping this row.")
                    # Try to click Submit anyway to move to next
                    await page.locator("button:has-text('Submit')").first.click()
                    await asyncio.sleep(2)
                    continue

                # 3. Submit correction
                success = await submit_correction(page, correction)

                if not success:
                    print("⚠ Failed to submit. Waiting 5 seconds before next attempt...")
                    await asyncio.sleep(5)

                # Small delay between iterations
                await asyncio.sleep(1)

            print("\n" + "="*60)
            print("Automation completed successfully!")
            print("="*60)

            # Keep browser open for a moment
            print("\nPress Enter to close Firefox...")
            input()

            await context.close()

        except Exception as e:
            print(f"\nError in main loop: {e}")
            import traceback
            traceback.print_exc()
            print("\nTroubleshooting tips:")
            print("1. Make sure Chrome is installed on your system")
            print("2. Close any running Chrome instances before running this script")
            print("3. Check that you're on editor.labelbox.com")
            print("4. Verify ANTHROPIC_API_KEY is set in .env file")


if __name__ == "__main__":
    asyncio.run(main())

# Labelbox Automation Script

Automates the Labelbox labeling workflow by launching Chrome with your existing profile (preserving cookies/sessions), scraping row data, calling Claude API for corrections, and submitting the results.

## Setup

### 1. Install Dependencies

```bash
pip install -r labelbox_requirements.txt
```

### 2. Configure Environment Variables

Create a `.env` file in this directory:

```bash
cp .env.example .env
```

Edit `.env` and add your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-api03-...
```

Get your API key from: https://console.anthropic.com/

### 3. Close Chrome

**IMPORTANT:** Close all Chrome windows before running the script. The script needs exclusive access to your Chrome profile.

### 4. Run the Script

```bash
python labelbox_automation.py
```

The script will:
- Launch Chrome with your existing profile (so you're already logged in)
- Prompt you to navigate to editor.labelbox.com if needed
- Start automating once you press Enter

## How It Works

The script performs these steps in a loop:

1. **Scrapes** the current row's:
   - Image (converted to base64)
   - Question text
   - Model's answer

2. **Calls Claude API** with the scraped data to get a correction

3. **Pastes** the correction into the "Correct Answer" textarea (class `css-16l8qav`)

4. **Attempts to set** the classification dropdown (if present)

5. **Clicks Submit** to move to the next row

6. **Repeats** until the Submit button is no longer visible

## Customization

If the script can't find elements on the page, you may need to adjust the selectors in `labelbox_automation.py`:

- **Image selectors** (line ~65): Update `image_selectors` list
- **Question selectors** (line ~110): Update `question_selectors` list  
- **Model answer selectors** (line ~140): Update `model_answer_selectors` list
- **Textarea selector** (line ~275): Update `"textarea.css-16l8qav"`
- **Submit button** (line ~305): Update `submit_selectors` list

Use Firefox DevTools (F12) to inspect elements and find the correct selectors.

## Troubleshooting

### "Chrome user data directory not found"
- The script looks for Chrome profile at: `C:\Users\Alexander\AppData\Local\Google\Chrome\User Data`
- If your Chrome is installed elsewhere, set the `CHROME_USER_DATA` environment variable in `.env`

### Chrome doesn't launch or shows "profile in use" error
- **Close ALL Chrome windows** before running the script
- Check Task Manager and end any chrome.exe processes
- Chrome profile can only be used by one instance at a time

### Script can't find Labelbox page
- The script will prompt you to navigate to editor.labelbox.com
- Just open the page in the launched Chrome window and press Enter in the terminal

### Already logged into Labelbox in regular Chrome, but script shows login page
- Make sure you closed ALL Chrome windows before running the script
- The script uses your Default profile which should have your Labelbox cookies

### "ANTHROPIC_API_KEY not found"
- Create a `.env` file in the same directory as the script
- Add your API key: `ANTHROPIC_API_KEY=sk-ant-api03-...`

### Script can't find elements
- Use Firefox DevTools (F12) to inspect the page structure
- Update selectors in the script to match Labelbox's actual DOM
- Add `print()` statements to debug what the script is seeing

### Rate limiting
- The script includes small delays between requests
- Claude API has rate limits - if you hit them, the script will show errors
- Consider adding longer delays in the main loop if needed

## Development Tips

To test element detection without making API calls:

```python
# Comment out the Claude API call section and just print what was scraped
correction = f"TEST: {row_data.get('question', '')[:50]}"
```

To run in "dry run" mode (don't click Submit):

```python
# Comment out the submit click line
# await page.locator(selector).first.click()
print(f"Would click submit with correction: {correction[:100]}")
```

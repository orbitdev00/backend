# Labelbox Automation Script

Automates the Labelbox labeling workflow by connecting to your existing Firefox browser via Marionette protocol, scraping row data, calling Claude API for corrections, and submitting the results.

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
MARIONETTE_PORT=2828
MARIONETTE_HOST=localhost
```

Get your API key from: https://console.anthropic.com/

### 3. Start Firefox with Marionette Enabled

**Windows:**
```bash
firefox.exe -marionette
```

**Mac:**
```bash
/Applications/Firefox.app/Contents/MacOS/firefox -marionette
```

**Linux:**
```bash
firefox -marionette
```

The `-marionette` flag enables Firefox's native automation protocol on port 2828.

> **Note:** If Firefox is already running, close it first and reopen with the `-marionette` flag.

### 4. Navigate to Labelbox

In the Firefox browser window, navigate to `editor.labelbox.com` and log in to your labeling task.

### 5. Run the Script

```bash
python labelbox_automation.py
```

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

### "Connection refused" or "Unable to connect"
- Make sure Firefox is started with the `-marionette` flag
- Check that port 2828 is not blocked by firewall
- Verify Firefox is actually running before starting the script

### "Could not find editor.labelbox.com tab"
- Navigate to the Labelbox editor before running the script
- Make sure the URL contains `editor.labelbox.com`
- The script will try to switch to the correct tab automatically

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

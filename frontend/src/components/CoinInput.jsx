import { useRef } from 'react'
import './CoinInput.css'

export default function CoinInput({ value, onChange, onSubmit, onRefresh, loading, hasData }) {
  const inputRef = useRef(null)

  const handlePaste = () => {
    // Focus the input first, then read clipboard
    if (inputRef.current) inputRef.current.focus()

    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText()
        .then(text => {
          if (text) onChange(text.trim())
        })
        .catch(() => {
          // Clipboard permission denied — focus input so user can Ctrl+V manually
          if (inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
          }
        })
    } else {
      // Older browser fallback
      if (inputRef.current) {
        inputRef.current.focus()
        document.execCommand('paste')
      }
    }
  }

  return (
    <div className="coin-input-wrap">
      <div className="coin-input-row">
        <button className="btn-paste" onClick={handlePaste} title="Paste from clipboard">⎘</button>
        <input
          ref={inputRef}
          className="coin-input"
          type="text"
          placeholder="Paste Token CA..."
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSubmit()}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn-analyze" onClick={onSubmit} disabled={loading || !value.trim()}>
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
        {hasData && (
          <button className="btn-refresh" onClick={onRefresh} title="Refresh analysis">↻</button>
        )}
      </div>
    </div>
  )
}

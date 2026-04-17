import './CollapsiblePanel.css'

export default function CollapsiblePanel({ title, id, collapsed, toggle, children }) {
  const isCollapsed = collapsed[id]
  return (
    <div className={`collapsible ${isCollapsed ? 'is-collapsed' : ''}`}>
      <div className="collapsible-header" onClick={() => toggle(id)}>
        <span className="collapsible-title">{title}</span>
        <span className="collapsible-arrow">{isCollapsed ? '▸' : '▾'}</span>
      </div>
      {!isCollapsed && (
        <div className="collapsible-body">
          {children}
        </div>
      )}
    </div>
  )
}

import re

with open("index.html", "r", encoding="utf-8") as f:
    html = f.read()

# 1. Update CSS for properties-panel and layer-panel
html = html.replace('#properties-panel {', '#properties-panel, #layer-panel {')
html = html.replace('#properties-panel.collapsed {', '#properties-panel.collapsed, #layer-panel.collapsed {')
html = html.replace(
    '#status-bar { height:24px;background-color:var(--panel-bg);border-top:1px solid var(--border-color);display:flex;align-items:center;padding:0 10px;font-size:12px;justify-content:space-between; }',
    '#status-bar { height:24px;background-color:var(--panel-bg);border-bottom:1px solid var(--border-color);display:flex;align-items:center;padding:0 10px;font-size:12px;justify-content:space-between; }'
)

# 2. Add Layer Panel HTML
layer_panel_html = """        <div id="layer-panel" class="collapsed">
            <div class="props-header">
                <span>画層プロパティ</span>
                <button class="status-btn" onclick="toggleLayerPanel()" style="padding:0;">✖</button>
            </div>
            <div class="props-content" id="layer-list" style="padding:0;">
                <!-- Layers will be inserted here dynamically -->
            </div>
        </div>
"""
# Insert layer-panel after properties-panel
html = html.replace(
    '        </div>\n    </div>\n    <div id="command-line-area">',
    '        </div>\n' + layer_panel_html + '    </div>\n    <div id="command-line-area">'
)

# 3. Add Layer Toggle Button to Top Bar
html = html.replace(
    '<select id="layer-select"></select>\n        </div>',
    '<select id="layer-select"></select>\n            <button class="status-btn" onclick="toggleLayerPanel()" style="padding:0 5px;" title="画層表示切り替え">👁️</button>\n        </div>'
)

# 4. Move Status Bar from bottom to below Top Bar
status_bar_pattern = r'(\s*<div id="status-bar">.*?</div>\n)'
match = re.search(status_bar_pattern, html, flags=re.DOTALL)
if match:
    status_bar_html = match.group(1)
    # Remove from bottom
    html = html.replace(status_bar_html, '')
    # Insert below top-bar
    html = html.replace('    </div>\n    <div id="middle-area">', '    </div>' + status_bar_html + '    <div id="middle-area">')

with open("index.html", "w", encoding="utf-8") as f:
    f.write(html)

print("HTML update complete.")

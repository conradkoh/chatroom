# Plan 001: Dark/Light Mode Theme Fix - PRD

## Glossary

| Term | Definition |
|------|------------|
| **Dark Steel Theme** | The primary dark theme variant as defined in `docs/design/theme.md`. Uses zinc-950 backgrounds, zinc-100 text, and bright status colors (emerald-400, amber-400, red-400, blue-400). |
| **Neutral Glass Theme** | The light theme variant as defined in `docs/design/theme.md`. Uses neutral-100 backgrounds, neutral-900 text, and darker status colors (green-700, amber-700, red-700, blue-700). |
| **Semantic Token** | CSS custom property or Tailwind class that adapts based on the current theme (e.g., `bg-background`, `text-foreground`) |
| **Hardcoded Color** | A direct color value (e.g., `bg-zinc-950`, `text-zinc-100`) that doesn't change with theme |
| **Chatroom Module** | The collection of components under `apps/webapp/src/modules/chatroom/` that implement the multi-agent chatroom functionality |
| **`.chatroom-root`** | The CSS class applied to chatroom module containers that provides scoped CSS variables |

## User Stories

### US-001: Theme Toggle Affects All UI
**As a** user  
**I want** the entire application to change colors when I toggle the theme  
**So that** I can use the app comfortably in different lighting conditions

**Acceptance Criteria:**
- When I switch to light mode, all components including chatroom use light backgrounds and dark text
- When I switch to dark mode, all components including chatroom use dark backgrounds and light text
- When I select system mode, the app follows my OS preference

### US-002: Consistent Navigation Header
**As a** user  
**I want** the navigation header to match the current theme  
**So that** there's no jarring visual contrast between the header and page content

**Acceptance Criteria:**
- In light mode, the navigation has a light background
- In dark mode, the navigation has a dark background
- Text and icons in the header are readable in both modes

### US-003: Readable Chatroom Messages
**As a** user  
**I want** chatroom messages and markdown content to be readable in light mode  
**So that** I can use the chatroom feature without eye strain in bright environments

**Acceptance Criteria:**
- Message text has sufficient contrast against the background in both modes
- Markdown/prose content adapts to the current theme
- Code blocks and inline code are readable in both modes

### US-004: Visible Interactive Elements
**As a** user  
**I want** buttons, inputs, and interactive elements in the chatroom to be visible in light mode  
**So that** I can clearly see and interact with all controls

**Acceptance Criteria:**
- Buttons have visible borders and text in light mode
- Input fields have visible borders and placeholder text in light mode
- Hover and focus states are visible in both modes

### US-005: Status Colors Remain Distinguishable
**As a** user  
**I want** status indicators (success, warning, error, info) to remain clearly distinguishable in both themes  
**So that** I can quickly understand system states regardless of my theme choice

**Acceptance Criteria:**
- Success states use green tones appropriate for the current theme
- Warning states use amber/yellow tones appropriate for the current theme
- Error states use red tones appropriate for the current theme
- Info states use blue tones appropriate for the current theme

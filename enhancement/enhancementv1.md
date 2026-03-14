# Enhancement v1

## 1. History with Response
- Save the full response (status, body, headers, duration) alongside each history entry
- When restoring a history entry, populate both the request panel AND the response panel
- Allows reviewing past results without re-sending the request

## 2. Keyboard Shortcut Cheat Sheet (`Cmd+/`)
- Overlay modal showing all available shortcuts in a clean grid layout
- Group by category: Navigation, Request, Tabs, Search, etc.
- Dismiss with `Esc` or clicking outside

## 3. Response Search (`Cmd+G`)
- Search box within the response body panel
- Highlight all matches in the JSON with a match counter (e.g., "3 of 12")
- `Enter` / `Shift+Enter` to jump between matches

## 4. Copy as cURL
- Button in the request panel (next to Send) that copies the current request as a `curl` command
- Include: method, URL (resolved), headers, body, content-type
- Supports all three protocols (gRPC-Web → HTTP POST, gRPC → grpcurl format, SDK → HTTP equivalent)

## 5. Response Size Indicator
- Show formatted response body size (e.g., `2.4 KB`) in the status bar next to duration
- Format: `B` / `KB` / `MB` depending on size

## 6. Bulk Request Runner (`Cmd+B`)
- Dialog with a form:
  - **Method selector**: pick from installed methods (reuse search/autocomplete)
  - **Request count**: number input for how many times to send
  - **Concurrency mode**: toggle between "All at once" (parallel) and "Sequential"
  - **Headers / Body**: pre-filled from the active tab, editable
- **Send** button at the bottom to fire all requests
- **Results table**: shows each request's index, status, duration, and response size
- **Summary row**: total time, success count, fail count, avg/min/max duration

7. 
Penguin Tips
Idle for 30 seconds? Penguin shows a random tip:
"Did you know? Cmd+E switches protocols!"
"Try * wildcards in search for pattern matching"
"Double-click a tab to rename it"
Dismiss or "Don't show again"

8. 
check wifi
if not connected, will alert user

9. 
Font Size Scaling
Cmd++/ Cmd+- to increase/decrease font size globally
Persisted in settings
Especially important for the JSON editor and response body

10. 
Tab Drag to Reorder
Drag tabs left/right to reorder them
Drop a tab outside the bar to detach it (future: into a new window)
Visual: tab lifts slightly when dragging, drop zone highlights

11. history should have date and time and day (Friday...)

12. 
Malaysian Holiday Greetings
Auto-detect: CNY, Hari Raya, Deepavali, Christmas, Merdeka Day, etc.
Special greetings: "Gong Xi Fa Cai, Shi Eng! May your APIs return 200"
Special penguin outfit for the day

13. 
Late Night / Overtime Messages
After 9 PM: "Shi Eng, OT king sia — remember to rest"
After 11 PM: "Walao still working? Go sleep la"
After midnight: "Penguin is sleeping, but still supporting you..."
After 2 AM: "Emergency OT mode activated. Penguin salutes you"

14. 
Weekend Messages
Saturday: "Weekend debugging? Shi Eng, respect"
Sunday: "Shi Eng, even penguin rest on Sunday la"

15. 
Header Presets
Dropdown: "Common headers" → one-click add:
Authorization +Bearer template
Content-Type: application/json
eId +empty value
Custom saved header sets per protocol

16. 
Body Character Count
Small indicator below the JSON editor: "234 chars | 12 lines"
Warns if body exceeds a threshold: "Body is 50KB — this may be slow"

17. 
Body Prettify Button with Minify Toggle
Two buttons: "Pretty" (current format button) and "Minify"
Minify strips all whitespace — useful for copying compact JSON
Toggle between views

18.
Response Timestamp
Show when the response was received: "Received at 10:32:45 AM"
Useful when you leave a tab open and come back later
"This response is 2 hours old"

19. 
On app startup, check if newer versions of installed packages exist on the registry
Show a small badge on the sidebar: "2 updates available"
Click to see: @snsoft/player-grpc: 1.0.0-20260308 → 1.0.0-20260313
One-click update

20. 
Package Size Display
Show the installed size of each package: @snsoft/player-grpc (2.1 MB)
Total at the bottom: "Total packages: 12.4 MB"

21. 
Package Lock
Lock a package to prevent accidental deletion or update
Small lock icon next to the package name
Must unlock first before uninstall/update

22. 
Export All Settings
One-click export everything: environments, theme, username, collections, notes, bookmarks
Single .penguin-backup.json file
Import on a fresh install or new machine

23. 
Interactive Walkthrough (not just slides)
Current tutorial is a step-by-step slideshow — upgrade to an interactive overlay
Highlight the actual UI element: "Click here to install a package" with the sidebar glowing
User performs the action → tutorial advances
Like a game tutorial — learn by doing, not reading

24. 
Empty State Guides
When response panel is empty: show not just text but a quick 3-step visual guide
When sidebar has no packages: animated arrow pointing to Cmd+S
When body is {}: "Select a method to auto-fill from proto"
Each empty state teaches the user something

25. 
User Profiles / Switch Account
Multiple user profiles on the same machine
Each profile has its own: username, environments, history, collections, theme
"Alice (QA)" vs "Bob (Backend Dev)"
Switch in settings — like Chrome profiles

26. 
Role-Based Presets
On first launch, ask: "What's your role?"
QA → pre-configures: history enabled, assertions panel, bulk runner prominent
Backend Dev → pre-configures: raw view default, gRPC tab, proto docs panel
Frontend Dev → pre-configures: gRPC-Web tab, SDK tab, copy as fetch
Customizable after selection

27. 
Smart Paste
Paste a raw JSON string into the body → auto-detect and format it
Paste a URL → auto-fill the URL bar and detect environment
Paste curl -X POST ... → reverse-parse into Penguin: fills URL, headers, body
Paste a player ID → auto-fill into the focused field

28. 
Environment Import from cURL
Paste a cURL command → Penguin extracts the URL and creates an environment entry
Detects common patterns: fpms-nt.platform88.me → suggests "QAT1"

29. 
Response Lazy Rendering
For very large responses (10K+lines), only render visible lines
Virtual scrolling like VS Code — render 50 visible lines, lazy-load the rest
Prevents UI freeze on massive responses

30. 
Background Tab Throttling
Tabs not in focus don't re-render on state changes
Save memory when 10+tabs are open
Only update when the tab becomes active

31. 
Request Cancellation
While a request is loading, show a "Cancel" button
Esc while loading cancels the in-flight request
Important for slow requests that you realize have wrong parameters

32. 
Proto File Viewer
Click a method → "View Proto" → shows the raw .proto source with syntax highlighting
Navigate: click a message type → jumps to its definition
Read-only, but great for understanding the API

33. 
Auto-Launch on Login
Toggle in settings: "Start Penguin when macOS starts"
Launches minimized / to tray
Ready when you need it without waiting for startup

34. 
Penguin Loading Animations
Instead of a plain spinner when loading, show a small penguin animation:
Penguin waddling across the screen
Penguin tapping its foot impatiently
Penguin fishing (waiting for the response to "bite")
Different animation each time

35. 
Print-Friendly View
Cmd+P generates a clean printable view:
Request details, headers, body
Response status, body
No UI chrome, just data
PDF export for documentation

36. 
Konami Code
Type ↑↑↓↓←→←→BA → penguin dances, confetti, secret theme unlocked
The "developer mode" theme: matrix green on black

37. 
Multi-Window Support
Detach a tab into its own window: drag tab out of the bar or right-click → "Open in new window"
Each window is independent
Side-by-side comparison on a large monitor

38. 
Request as Documentation
will pop out in a form, copy button, proper form
header, request proto message..., current reqBody, response proto message ..., current response, url, path..... and more related, all in proper string, can direct copy and send as message



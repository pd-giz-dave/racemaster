# RaceMaster

An offline first web-based fell race management system designed to handle all aspects of running a fell race event, 
from pre-registration through to final results. Will run on anything that can run a modern web browser.

## Features

- **Event setup** — configure event details and race categories
- **Pre-entries** — import pre-entry data from various sources
- **On-the-day registration** — extremely fast entrant registration (as little as 3 keystrokes)
- **Finishers** — extremely fast recording of start and finish times and positions (could do it in real-time at the end of the finish funnel)
- **Timing** - multiple options including: stopwatch, SI Timing integration
- **Results** — calculate and display results
- **Paperwork** — generate race day forms
- **Prize list** — print prize list for presentation
- **Export/Import** — save and restore event data to/from local storage or the cloud
- **Run in th wild** - configure the event with internet access then go into the wild with no internet or mobile signal, run the event, on return auto syncs to the cloud.

## History

This is a translation of a spreadsheet used by Mercia Fellrunners for over twenty years.
It embodies all the experience of running fell races over that period, including: junior races, adult races, and national championship races.

## ToDo

This is an early work in progress.
Its feature complete except for form printing and publishing results.
Please check back later for updates.

## Running the App Locally

Requires [Node.js](https://nodejs.org/).

```bash
node server.js
```

Then open your browser at `http://localhost:3000`.

The app also works as a Progressive Web App (PWA) and can be installed on mobile devices.
(This feature is still in development.)

## Authentication

Users are managed via `users.txt` and `admins.txt` in the project root.

## Data

Event data is stored as JSON files in the `data/` directory.

## License

MIT — see [LICENSE](LICENSE).
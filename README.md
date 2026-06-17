# RaceMaster

An offline first web-based fell race management system designed to handle all aspects of running a fell race event, from pre-registration through to final results.

## Features

- **Event setup** — configure event details and race categories
- **Pre-entries** — import pre-entry data from various sources
- **On-the-day registration** — manage entries and helpers
- **Finishers** — record start and finish times and positions
- **Results** — calculate and display results
- **Paperwork** — generate race day forms
- **Prize list** — print prize list for presentation
- **Export/Import** — save and restore event data

## ToDo

This is an early work in progress.
Its feature complete except for form printing and publishing on a website.
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
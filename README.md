# RaceMaster

An offline first web-based fell race management system designed to handle all aspects of running a fell race event, 
from pre-registration through to final results. Will run on anything that can run a modern web browser.

## Features

- **Event setup** — configure event details and race categories
- **Pre-entries** — import pre-entry data from various sources
- **On-the-day registration** — extremely fast entrant registration (as little as 3 keystrokes)
- **Finishers** — extremely fast recording of start and finish times and positions (it can be done in real-time at the end of the finish funnel)
- **Timing** - multiple options including: stopwatch, SI Timing integration, early and late starters
- **Juniors** — junior races can run concurrently with adult races using the same stopwatch
- **Results** — calculate and display results and print a prize list by category
- **Paperwork** — generate entry forms for on-the-day and pre-registered entrants
- **Export/Import** — save and restore event data to/from local storage or the cloud
- **Run in th wild** - configure the event with internet access then go into the wild with no internet or mobile signal, run the event, on return auto syncs to the cloud.
- **Run standalone** - will run standalone using just local storage, just visit the website where the app is deployed - job done

## History

This is a translation of a spreadsheet used by Mercia Fellrunners for over twenty years.
It embodies all the experience of running fell races over that period, including: junior races, adult races, and national championship races.

## ToDo

This is an early work in progress.
Please check back later for updates.

## Running the App With a Local server

Requires [Node.js](https://nodejs.org/).

```bash
node server.js
```

Then open your browser at `http://localhost:3000`.

The app also works as a Progressive Web App (PWA) and can be installed on mobile devices.

## Installation

The simplest way is to deploy as a Docker container. 
There is a docker-compose.yml and a Dockerfile in the project root, 
it pulls a standard node image, the rest is just the files of this project.
Copy the project root to a suitable location, 
edit docker-compose.yml to suit your context, and fire up the container - job done.

```bash
docker-compose up
```

## Authentication

Users are managed via a simple `users.txt`, `admins.txt` and `sessions.txt` text files in the project root 
(passwords are encrypted). The first user created is an admin, 
thereafter new users are not admins but any current admin can grant or revoke admin rights to others.

## Data

Event data is stored as JSON files in the `data/` directory.
Data also includes a 'people' database that accumulates from race to race, 
allowing entry form auto-complete for entrants that have been seen before.
Data can also be exported to a CSV file for easy import into spreadsheets.

## License

MIT — see [LICENSE](LICENSE).
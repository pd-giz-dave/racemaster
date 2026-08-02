'use strict';

// ----------------------------------------------------------------
// All user-visible text strings for the UI.
// Edit this file to change button tooltips, page help text, and
// table column names and order.
// TOOLTIPS: element id → tooltip string (shown on hover)
// HELP:     view id   → HTML shown in the collapsible help panel
// PAGES:    page id   → HTML shown in static help pages
// TABLES:   table id  → array of { id, label, title } column defs
//   id    — stable identifier used by call sites to wire render fns;
//            never change this
//   label — column header text shown in the UI; safe to rename
//   title — tooltip shown on the column header
// ----------------------------------------------------------------

export const TOOLTIPS = {
  // Header
  'btn-nav-toggle':              'Open / close the navigation menu',
  'btn-app-about':               'About RaceMaster',
  'btn-app-whats-new':           "What's new in this version",
  'btn-app-update':              'A new version of RaceMaster is available — click to apply it',

  // Datasets view
  'btn-export-state':            'Export all event data as a JSON backup file',
  'btn-import-state':            'Import event data from a JSON backup file',

  // Event settings
  'ev-name':                     'The name of the race event',
  'ev-date':                     'The date of the race',
  'ev-distance':                 'Race distance in kilometres',
  'ev-categories':               'Age category scheme — FRA uses 5-year bands, WFRA uses 10-year bands',
  'ev-first-bib':                'Bib numbers are assigned sequentially starting from this number',
  'ev-first-dibber':             'Dibber (SI card) short codes are allocated starting from this number',
  'ev-has-pairs':                'Tick if the race includes pairs (two competitors sharing a single bib and/or dibber)',
  'ev-start-time':               'Expected mass start time for seniors (info only, the actual time is recorded in the finishers list)',
  'ev-entry-limit':              'Maximum number of senior entries allowed (0 = no limit)',
  'ev-timing-method':            'How senior finish times are recorded — Stopwatch (manual entry), Dibbers (SportIdent), or None',
  'ev-male-record':              'Current male course record — used to highlight new records in the results',
  'ev-female-record':            'Current female course record — used to highlight new records in the results',
  'ev-junior-start-time':        'Expected mass start time for juniors (info only, the actual time is recorded in the finishers list)',
  'ev-junior-limit-n':           'Maximum number of junior entries (0 = no limit)',
  'ev-junior-timing':            'Timing method for juniors — same options as seniors',
  'ev-junior-limit':             'Competitors at or below this age category are treated as juniors (auto during registration)',
  'ev-prize-overall':            'Number of overall prizes (e.g. 3 = 1st, 2nd, 3rd place overall)',
  'ev-prize-per-cat':            'Number of prizes awarded per senior age category',
  'ev-prize-junior-cat':         'Number of prizes awarded per junior age category',
  'ev-organisation':             'Name of the organising club or body — appears on printed forms',
  'ev-clear-previous':           'Tick before saving to wipe all entries, pre-entries, finisher and results data and start fresh for a new race',
  'btn-save-event':              'Save all event settings',

  // Pre-entries
  'btn-import-si-entries':       'Import a pre-entry CSV file from SportIdent or EntryCentral or anything that provides entry-number, name, gender and date-of-birth columns',
  'btn-clear-pre-entries':       'Clear all pre-entries',

  // Paperwork
  'btn-print-entry-form':          'Print blank entry forms for (solo) competitors to fill in at registration',
  'btn-print-pre-entry-forms':     'Print entry forms pre-filled with pre-entry details — load pre-entries first',
  'btn-print-pairs-entry-forms':            'Print blank pairs entry forms with two entrant sections and two signature lines',
  'btn-print-pre-entry-pairs-entry-forms':  'Print pairs entry forms pre-filled with pre-entry details — load pre-entries first',
  'btn-print-helpers-list':        'Print a blank helpers list for the RO to record names and roles on race day',
  'btn-print-finish-senior':     'Print a blank senior finish sheet for recording finish order',
  'btn-print-finish-junior':     'Print a blank junior finish sheet for recording finish order',
  'btn-print-number-matrix':     'Print a 2D grid showing all bib numbers for cross-checking at CPs',
  'bib-first':                   'First bib number to print — must be between 1 and 999',
  'bib-count':                   'Number of bibs to print — first + count must not exceed 999',
  'btn-print-bibs':              'Print race bibs 2-up on A4; guillotine the stack to produce two sorted A5 piles',

  // Entries
  'btn-export-entries-si':       'Export the entry list as a CSV for importing into the SI Timing system (for when using dibbers)',
  'btn-clear-all-entries':       'Delete all entries — cannot be undone',
  'entry-form-type':             'Solo entry or pair (two competitors sharing one bib and dibber)',
  'entry-form-peno':             'Pre-entry reference number — auto-fills details from the pre-entries list; or just type a name',
  'entry-form-bib':              'Bib number — assigned automatically in sequence; edit to override',
  'entry-form-dibber':           'SI card (dibber) short code — assigned automatically in sequence; edit to override',
  'entry-form-name':             "Competitor's full name — type to search the people database",
  'entry-form-dob':              'Date of birth (DD/MM/YY) — used to determine age category',
  'entry-form-gender':           'Gender — used to determine age category',
  'entry-form-club':             "Competitor's running club",
  'entry-form-fra':              'FRA (Fell Runners Association) registration number',
  'entry-form-category':         'Age category — leave as auto to determine from date of birth and gender',
  'entry-form-course':           'Race course — leave as auto to determine from age category',
  'btn-submit-entry':            'Register this competitor and add them to the entry list',
  'btn-reset-entry':             'Clear the form ready to register the next competitor (auto on register)',
  'btn-cancel-edit':             'Cancel editing and return to the entry list',

  // Helpers
  'btn-clear-all-helpers':       'Delete all helper records — cannot be undone',
  'helper-form-name':            "Helper's full name",
  'helper-form-gender':          'Gender',
  'helper-form-dob':             'Date of birth (DD/MM/YY) - optional',
  'helper-form-club':            'Running club - optional',
  'helper-form-role':            "Helper's role — e.g. Timekeeper, Marshal, Registration",
  'helper-form-role-desc':       'Description of the role — filled automatically for known roles',
  'btn-submit-helper':           'Add this helper to the list',
  'btn-reset-helper':            'Clear the form',
  'btn-cancel-helper-edit':      'Cancel editing',

  // Finishers
  'btn-clear-all-finishers':     'Delete all finisher records — cannot be undone',
  'finisher-mode':               'Bibs mode: enter bib numbers as competitors finish; Time mode: enter times against already-recorded bibs',
  'finisher-line':               'Current position in the finish order (read-only)',
  'finisher-bib':                'Race (bib) number of the finisher, or a special code (DNF etc.)',
  'finisher-prev-time':          'Time recorded for the previous finisher (read-only)',
  'finisher-time':               'Finish time or elapsed time — enter as ss, mm:ss or hh:mm:ss; use - to skip, any separator works, e.g. space',
  'finisher-is-finish':          'Record this as a normal finish',
  'finisher-is-start':           'Record this as an individual start time (for competitors who started early or late)',
  'finisher-is-retire':          'Record this competitor as a retiree / did not finish (DNF)',
  'btn-submit-finisher':         'Record this finisher - the form auto resets ready for the next record',
  'btn-cancel-finisher-edit':    'Cancel editing',

  // SI Results
  'btn-import-si-results':       'Import an SI Timing (processable) results CSV file to load finish times when using dibbers',
  'btn-clear-si-results':        'Delete all imported SI results — cannot be undone',

  // Results
  'btn-print-prize-list':        'Print the prize list for the presentation',
  'btn-export-results-csv':      'Export results as a CSV spreadsheet for publication or DIY manipulation',
  'btn-publish-results':         'Publish results online',
  'btn-show-embed-code':         'Open the published results page in a new tab',
  'published-url-field':        'Click to copy this URL to the clipboard',

  // People
  'people-filter':               'Filter the people list by name or club',
  'people-show-banned':          'Show competitors who are currently banned from competition',
  'btn-show-all-people':         'Clear the filter and show all people',
  'btn-export-people':           'Export the people database as a CSV file',
  'btn-import-people':           'Import people records from a CSV file',
  'btn-merge-people':            'Merge people records from another dataset or JSON backup file',
  'btn-find-dupes':              'Find possible duplicate people records based on name similarity',
  'btn-clear-people':            'Delete all people records — cannot be undone',
  'btn-close-dupes':             'Close the duplicates panel',
  'people-merge-ds-select':      'Dataset to merge people from',
  'btn-do-merge-ds':             'Merge people from the selected dataset into this one',
  'btn-merge-from-file':         'Merge people from a JSON file exported from another dataset',
  'btn-cancel-merge':            'Cancel the merge operation',

  // Clubs
  'btn-merge-clubs':             'Merge the selected clubs into a single club',
  'btn-find-dupe-clubs':         'Find possible duplicate club names',
  'clubs-merge-name':            'Name to merge the selected clubs into — can be an existing club or a new name',
  'btn-do-merge-clubs':          'Perform the merge',
  'btn-cancel-merge-clubs':      'Cancel',
  'btn-close-dupe-clubs':        'Close the duplicate clubs panel',

  // Roles
  'btn-add-role':                'Add a new helper role',
  'btn-export-roles':            'Export roles as a CSV file',
  'btn-import-roles':            'Import roles from a CSV file',
  'btn-reset-roles':             'Restore the built-in default roles',
  'btn-clear-roles':             'Delete all roles - cannot be undone',

  // Dibbers
  'btn-add-dibber':              'Add a dibber (SI card) record manually',
  'btn-import-dibbers':          'Import dibber records from a CSV file',
  'btn-export-dibbers':          'Export dibber records as a CSV file',
  'btn-merge-dibbers':           'Merge dibber records from another dataset or JSON backup file',
  'btn-do-merge-ds-dibbers':     'Merge dibbers from the selected dataset into this one',
  'btn-merge-from-file-dibbers': 'Merge dibbers from a JSON file exported from another dataset',
  'btn-cancel-merge-dibbers':    'Cancel the merge operation',
  'btn-clear-dibbers':           'Delete all dibber records - cannot be undone',

  // Categories
  'btn-add-category':            'Add a new row to the custom categories',
  'btn-load-fra-preset':         'Copy the built-in FRA categories into the custom list (replaces any existing custom categories)',
  'btn-load-wfra-preset':        'Copy the built-in WFRA categories into the custom list (replaces any existing custom categories)',
  'btn-import-categories-csv':   'Import custom categories from a CSV file (replaces any existing custom categories)',
  'btn-export-categories-csv':   'Export custom categories to a CSV file',
  'btn-clear-categories':        'Delete all custom categories',

  // Mobile Files
  'btn-refresh-mobile-files':    'Reload mobile files from the server and from anything pulled locally over Bluetooth',
  'btn-connect-phone':           "Connect to a nearby phone running the RaceMaster mobile app over Bluetooth and pull its history — no network needed. Offers a direct reconnect for a phone connected to before; otherwise confirms the phone's name before connecting and rejects anything not running the app. Pushes straight to the server if reachable, otherwise saves locally to push later.",
  'btn-add-to-finishers':        'Add the selected mobile file(s) to the finishers list, as if entered manually — requires location "Finish", valid bib numbers, the same race, and no more than one bibs and one time phone selected',
  'btn-ble-logging':             'Log routine Bluetooth connect/pull activity to the browser console — off by default; a genuine connect/pull failure is always logged regardless',

  // Data file / auth
  'df-username':                 'Your RaceMaster username — use only letters, numbers and hyphens',
  'df-password':                 'Your RaceMaster password — use anything, its encrypted on the server',
  'df-btn-login':                'Sign in to your RaceMaster account',
  'df-btn-create-account':       'Create a new RaceMaster account',
  'df-btn-standalone':           'Use RaceMaster without a server — data is stored locally in this browser only',
  'df-btn-connect-push':         'Push pending local data changes to the server and connect to this dataset',
  'df-btn-connect-discard':      'Discard local changes and connect to this dataset from the server',
  'df-btn-connect-cancel':       'Cancel',
  'df-copy-name':                'Name for the new copy of this dataset',
  'df-btn-do-copy':              'Create the copy',
  'df-btn-cancel-copy':          'Cancel',
  'df-save-as-name':             'Name for the new dataset',
  'df-btn-do-save-as':           'Save the current data as a new dataset with this name (useful as a record post-race)',
  'df-btn-cancel-save-as':       'Cancel',
  'df-new-dataset-name':         'Name for the new dataset — use only letters, numbers and hyphens',
  'df-btn-create-dataset':       'Create a new empty dataset',
  'df-btn-save-as':              'Save the current data as a new dataset with a different name',
  'df-btn-logout':               'Sign out of your RaceMaster account',
};

export const HELP = {
  'view-home': `
    <p>The <strong>Home</strong> page shows a summary of the current event. Before you can do anything, 
        open <strong>Datasets</strong> page to log-in and select an existing event file or create a new one.</p>
    <p>Follow the <strong>Getting Started</strong> steps in order — they cover the typical workflow from setup through to results.</p>
    <p>It is recommended you create a <strong>master</strong> dataset to use as a template for all events,
        then after the race is over and all results published save it as a new dataset with a name that reflects the name and date of the event.
        That way your people database will accumulate and make future registrations easier.</p>
  `,
  'view-event': `
    <p>Set up the race details before printing paperwork or registering competitors.</p> 
    <p>The <strong>distance</strong> is used to split entrants into juniors or seniors according the FRA distance rules for juniors.</p>
    <p>The <strong>category scheme</strong> (FRA 5-year or WFRA 10-year) controls which age bands are used for results and prizes.</p>
    <p>The <strong>timing method</strong> determines how finishers are recorded.</p> 
    <p>All fields can be updated at any point. However, be wary of the <strong>Clear previous event</strong> checkbox, 
        which will reset all data and settings ready for a new event. 
        Use this once as you setup for a new race to clear all previous event specific data.</p>
   <p>The <strong>Has pairs</strong> option when checked enables pairs races.
        A pair in this context is two people racing together under the same bib (and dibber) number. 
        In Shropshire an example pairs race is the <strong>Time Trial</strong> held each year in November.</p>
  `,
  'view-pre-entries': `
    <p>Import a pre-entry list from a CSV file. Pre-entered competitors can have their details pre-printed on entry forms from the <strong>Paperwork</strong> page.</p>
    <p>Pre-entries can be imported from any source that provides the minimum information required for entries, 
        the minimum is: entrant number, first name, last name, gender and date of birth (SI Entries and Entry Central, at least, meet this requirement).</p>
  `,
  'view-forms': `
    <p>The <strong>Paperwork</strong> page provides facilities to print all the pre-race paperwork.</p>
    <p>Use <strong>Print Blank Entry Forms</strong> to generate one A4 page containing two entry forms, 
        print that as many times as required then guillotine into A5 sheets with one form per sheet.
        These are for solo races. Use <strong>Print Blank Pairs Entry Forms</strong> for pairs races.</p>
    <p>Use <strong>Print Pre-Entry Forms</strong> to generate multiple A4 pages with filled in entry forms, one for each pre-entry.
        They are generated two per A4 page in alphabetical order of surname in such a way that guillotining the whole 
        printed stack into A5 sheets maintains the order when the two half stacks are combined.
        These are for solo races. Use <strong>Print Pre-Entry Pairs Entry Forms</strong> for pairs races.</p>
    <p>The blank entry forms and the pre-filled ones have identical format and comply with FRA guidelines for both senior and junior races.</p>    
    <p>Use <strong>Print Helpers List</strong> to print a form intended to be given to the RO to record the names and roles of helpers. 
        They can be later registered as helpers for the race and thereby acknowledged in the results.</p>    
    <p>The <strong>Finish Sheets</strong> report is intended to be given to finish funnel marshals to record bib numbers as entrants cross the finish line.
        This is not necessary if dibber timing is being used but is useful as a backup (should SI Timing fail).
        The senior and junior sheets are identical, just a different number of pages created to cover the entry limits.</p>
    <p>The <strong>Number Matrix</strong> report is intended to be given to an on-course marshalls to check off runners as they pass a CP. 
        Bib numbers are always allocated sequentially, so this makes it easy to check for missing runners.</p>
    <p>The <strong>Print Bibs</strong> button allows you to print two A5 landscape numbers per A4 sheet, for use when the RO forgets to get bibs.</p>
  `,
  'view-entries': `
    <p>Add competitors as they register on race day. 
        Bib and dibber numbers are assigned automatically starting from the <strong>first bib number</strong> and <strong>first dibber number</strong>
        as set in Event Settings. Dibbers are only assigned if dibbers are being used for the course. 
        The course (Seniors or Juniors) is auto assigned according to the entrant category. The category is auto calculated from gender and date of birth.</p>
    <p>The form is designed to be used with a keyboard for very fast entry, typing a pre-entry number will auto-fill the rest of the form, 
        typing a name that has been seen before will do the same, then just pressing return (or enter) will add the entry. 
        The form will auto reset for the next entry.</p>
    <p>Use <strong>Export to SI</strong> to create a CSV file in a format that can be imported into SI Timing. This is only relevant when using dibber timing.</p>
    <p><strong>Clear All</strong> removes every entry and should only be used to start over.</p>
    <p>If you have enabled pairs in the event settings, this form will show a <strong>Type</strong> field that is either <strong>- Solo</strong> or <strong>= Pair</strong>.
        Typing '-' or '=' will change the selection.</p>
    <p>In all cases, when starting a new entry, typing a number or a name will do the appropriate thing, no need to tab to a specific field.</p>
  `,
  'view-helpers': `
    <p>Record officials, marshals and volunteers. Helpers can appear in the results report as an acknowledgement of their contribution to the event.</p>
    <p>As with entries, typing a name that has been seen before will autofill the rest of the form.</p>
    <p>Assign a <strong>role</strong> to each helper (e.g. Timekeeper, Marshal) so the report shows who did what. Roles are managed on the Roles page.</p>
  `,
  'view-finishers': `
    <p>When timing is via a stopwatch, record finishing positions and times. This is done in two stages: first record bib numbers in finishing order, 
        then in a subsequent pass assign their finishing times. The <strong>mode</strong> field determines which stage is being recorded.
        In <strong>Bibs</strong> mode fill the <strong>Race / Bib No.</strong> field and press return. 
        That bib is then recorded along with its clock split number (which auto increments), the form then resets ready for the next bib number.
        In <strong>Time</strong> mode enter the time the entrant (or pair) crossed the finish line. 
        In this mode, on pressing return, the form auto moves to the next record that has not got a time.</p>
    <p>In <strong>Bibs</strong> mode there are special codes that can be entered in the <strong>Race / Bib No.</strong> field.
        Click on the <strong>Race/Bib No.</strong> field to see the list along with a brief description of each.</p> 
    <p>One particular special code is always present as Bib No. 0 - <strong>Clock</strong>: This specifes the time reference for all other times.
        If a stopwatch is being used in a conventional way the time associated with this record is 0. 
        If the stopwatch was started late (after runners had already started) the time specifies how late (up to an hour).
        If the stopwatch is being used in <strong>time-of-day</strong> mode the time specifies the time of day the stopwatch was started. 
        All later times are then interpreted as time-of-day rather than split times.</p>    
    <p><div>
        This form, like entries, is very keyboard-centric.
        In particular, when <strong>entering a time</strong>, it can be done by:
        <ul style="margin-left:2em">
            <li>entering 3 numbers: hours and minutes and seconds with anything in between (space is easiest),</li>
            <li>or by 2 numbers: minutes then seconds, in this case the hours is inherited from the previous time,</li> 
            <li>or by 1 number: seconds, in this case the hours and minutes are inherited from the previous time.</li>
        </ul>
    </div></p>
    <p>If an entrant started early or late, record their individual start time by entering their BIb No and 
        checking the <strong>This is a start event</strong> option before pressing return. 
        This adds a special record where its time will be interpreted as the time the entrant actually started. 
        A subsequent finish record is also required, their elapsed time is then calculated as the difference.</p>
     <p>An entrant can also be marked as <strong>DNF</strong> (did not finish) by entering their Bib No and 
        checking the <strong>This is a retiree</strong> option before pressing return. 
        This adds a special record that indicates the entrant has finished but is excluded from the results (except as a DNF).
        These records do not get a split number.</p>
  `,
  'view-safety': `
    <p>In the <strong>Outstanding</strong> tab, shows all entrants who have <strong>not yet been recorded as finishers or retired</strong>. 
        Use this at the end of the race to confirm that everyone is accounted for.</p>
    <p>When the list is empty, all entrants have either finished or been marked as DNF. Use the other tabs to get more specific lists.</p>
  `,
  'view-si-results': `
    <p>Import finish times from an SI Timing (processable) results export. The import matches competitors by bib number. 
        Unmatched records and other errors can be seen in the <strong>Issues</strong> tab.</p>
    <p>Run this <strong>before</strong> to populate the <strong>Results & Prize List</strong> page. 
        You can re-import if more data arrives later.</p>
  `,
  'view-results': `
    <p>Results, prizes and helpers are calculated automatically when you open this page, across
        seven tabs: <strong>Progress</strong>, <strong>Prizes</strong>, <strong>Seniors</strong>,
        <strong>Juniors</strong>, <strong>Pairs</strong> (only present for a pairs race),
        <strong>Splits</strong> (only present once SI results carry split times) and
        <strong>Helpers</strong>.</p>
    <p><strong>Progress</strong> is shown first — one row per age category, in age order, with
        how many entrants in that category have <strong>Finished</strong> (retirees excluded)
        and how many are still <strong>Outstanding</strong> (neither finished nor retired). Use
        it to judge when it's safe to do the prize presentation.</p>
    <p>On the <strong>Seniors</strong> tab, <strong>%Ldrs</strong> shows each finisher's time as a
        percentage of the top 10 finishers' average (that average = 100%); <strong>R</strong>
        next to a time marks a course record, shown only when one's actually been broken.</p>
    <p>Use <strong>Export CSV</strong> to save the current tab's data as a spreadsheet for ad-hoc
        manipulation — available on the <strong>Seniors</strong>, <strong>Juniors</strong>,
        <strong>Pairs</strong> and <strong>Splits</strong> tabs. Use <strong>Print Prize List</strong>
        to print overall and category winners for the presentation.</p>
    <p>Use <strong>Publish Results</strong> to publish results as a HTML page that can be linked to from your website.
        The URL generated can be copied to the clipboard and pasted into a browser for direct viewing.
        Use the <strong>Show Published</strong> button to open the published URL.</p>
  `,
  'view-people': `
    <p>The master database of competitors. Records here can be persisted between events so names, 
        clubs and other relevant information accumulate to facilitate auto-complete during entry registration. 
        You can search, add and edit people directly on this page.</p>
    <p>People are also added automatically when a new name is entered during race-day registration.</p>
    <p>Use <strong>Find Duplicates</strong> to identify likely duplicated records and merge them.</p>
    <p>Use <strong>Merge...</strong> to merge people from another dataset into the list here.</p>
  `,
  'view-clubs': `
    <p>The master list of clubs used for auto-complete during entry. 
        Clubs are extracted from the people list, you can also manage them here.</p>
  `,
  'view-dibbers': `
    <p>Records the dibbers available for allocation during race-day registration.
        The short-code is used during registration and mapped to its corresponding long code when exporting entries to SI Timing.</p>
    <p>If the <strong>Lost</strong> column has a date, it indicates the dibber is no longer available and will not be allocated.</p>
    <p>Use <strong>Import CSV</strong> to import a dibber list, new short codes are added, existing ones are updated. 
        The CSV must include at least columns of "Short Code" and "Long Code".</p>
  `,
  'view-categories': `
    <p>The <strong>FRA</strong> (5-year age groups) and <strong>WFRA</strong> (10-year age groups)
        tabs show the built-in schemes (read-only). Select either scheme in Event Settings to use it.</p>
    <p>Use the <strong>Custom</strong> tab to define your own categories — load a preset as a starting
        point, then edit freely. Select <em>Custom</em> in Event Settings to activate your custom list.</p>
  `,
  'view-roles': `
    <p>The list of helper roles (e.g. Timekeeper, Start Marshal, Registration).
        Assign roles when recording helpers on the Helpers page so the helpers report shows who did what.</p>
    <p>Add roles here before recording helpers, or type them directly into the helpers form, or load the <strong>Built-in</strong> roles.</p>
  `,
  'view-datafile': `
    <p>Datasets are stored on the RaceMaster server. Each dataset holds <em>all</em> the data for one
        event — entries, finishers, results, categories, everything — as one self-contained unit. You'll
        normally create one dataset per event (or copy last year's as a starting point) rather than
        reusing a single dataset across multiple races.</p>

    <p>The page has up to four cards, depending on whether you're signed in:</p>
    <p><strong>Account</strong> (top-left) — sign in, create a free account, or
        <strong>Continue without signing in</strong> to work purely locally with no server at all
        (use <strong>Export</strong>/<strong>Import</strong>, top of the page, to save/restore a local
        JSON snapshot in that mode). Admin accounts get an extra <strong>Users</strong> section here
        for granting/revoking admin and deleting accounts.</p>
    <p><strong>Field-Use Testing</strong> — a <strong>Hide Server</strong> toggle that simulates the
        server being completely unreachable, exactly as it would be out on the course with no
        signal. Use it to check that offline behaviour (cached data, the local sync queue, connecting
        while offline) works the way you expect, without needing to actually lose signal.</p>
    <p><strong>Your Datasets</strong> — every dataset you own, plus every <em>public</em> dataset
        anyone has created (private datasets are only visible to their owner and admins). Your own
        rows are shaded differently from other users' public ones so the two are easy to tell apart
        at a glance. Each row shows:</p>
    <ul style="margin:0 0 12px 1.2em">
      <li>a <strong>Private</strong>/<strong>Public</strong> badge, with a <strong>→ public</strong>/
          <strong>→ private</strong> button (owners/admins only) to flip it — public means any other
          signed-in user can see and Copy it, private means only you (and admins) can;</li>
      <li><strong>(orphaned)</strong> next to the owner if that account no longer exists;</li>
      <li>a green <strong>Connected ✕</strong> badge instead of a Connect button on whichever dataset
          is currently active — click it to disconnect.</li>
    </ul>
    <p>Creating datasets:</p>
    <ul style="margin:0 0 12px 1.2em">
      <li><strong>New dataset</strong> — create a genuinely empty dataset from scratch.</li>
      <li><strong>Save As</strong> — the mirror image of Copy: takes whatever you
          currently have <em>open right now</em> — including any local edits not yet synced to the
          server — and saves it as a brand-new dataset. Use this to snapshot the current state of
          your work under a new name (e.g. keeping a copy of each year's results).</li>
    </ul>
    <p>Which of the action buttons you want depends on what you're trying to do:</p>
    <ul style="margin:0 0 12px 1.2em">
      <li><strong>Connect</strong> — make an existing dataset the active one, replacing whatever's
          currently loaded. If you have unsaved local changes it asks whether to push them to the
          server first or discard them before connecting.</li>
      <li><strong>Copy</strong> — duplicate <em>any</em> dataset you can see (yours or someone else's
          public one) into a new dataset of your own, under a new name, without touching what's
          currently connected. Use this to start a new event from an existing template, or to grab a
          copy of a public dataset to work from.</li>
      <li><strong>Delete</strong> (owners/admins only) — permanently removes a dataset and everything
          in it. If it's the one currently connected, you're disconnected first.</li>
    </ul>
    <p>Connect/Copy each open their confirmation right below the row you clicked, rather than at the
        bottom of the page, so a long dataset list never needs scrolling to see or act on them.</p>
    <p>When not signed in you'll see just the login panel: sign in to an existing account, create a
        new one (free, no catches), or select <strong>Continue without signing in</strong> to skip
        accounts entirely and work purely locally via Export/Import.</p>
  `,
  'view-mobile-files': `
    <p>Lists the timing data uploaded from the <strong>RaceMaster Mobile</strong> Android app, split across two tabs:
        <strong>Devices</strong> (one row per physical phone) and <strong>Bib Allocations</strong> (see below).
        You see your own uploads; admins see everyone's.</p>
    <p>Each device's file interleaves two independent record types: <strong>Bibs</strong> (bib-number entries, from Bibs or Checkpoint mode)
        and <strong>Time</strong> (stopwatch splits, from Time mode). The counts shown are only what's currently <em>visible</em> —
        the entries since that device's own last Reset — the same view the phone's own screen would show; a blank count means none of that type exist at all.</p>
    <p>The <strong>Location</strong> column should read the same for every visible line on a device — if it shows
        <strong>Inconsistent</strong>, the file has been mixed between two different course locations and needs checking.</p>
    <p><strong>View</strong> shows the Bibs and Time entries side by side, aligned by split number, with the location
        and each entry's time-of-day. <strong>Raw</strong> shows every field of every line exactly as stored, with nothing filtered or folded —
        useful for troubleshooting. <strong>Delete</strong> permanently removes a device's file from the server.</p>
    <p>Use <strong>Refresh</strong> to reload the list from the server and from anything already pulled locally over Bluetooth.</p>
    <p><strong>Connect to Phone…</strong> pulls a device's history directly over Bluetooth from a nearby phone running RaceMaster Mobile —
        no network needed, for use out on the course. The browser's own device picker can't show a meaningful name, so the first time you
        connect to a given phone you're asked to confirm its own name before anything is pulled — a device not running RaceMaster Mobile at
        all is rejected outright. A phone you've connected to before is instead offered directly as <strong>Reconnect to &lt;name&gt;</strong>,
        skipping the anonymous picker entirely (Chrome/Edge only — other browsers always use the picker). If the server is reachable the
        pull is then pushed straight there, the same as a normal WiFi sync;
        otherwise it's kept in this browser as <strong>pending upload</strong> until you push it (or discard it) once you're back in signal.
        Once connected, the button becomes <strong>Disconnect from &lt;device&gt;</strong> to end the session.
        Tick <strong>Bluetooth logging</strong> to also log routine connect/pull activity to the browser console — off by default, useful
        when troubleshooting a Connect to Phone… problem; the setting is remembered across visits to this page. A genuine connect or pull
        failure is always logged to the console regardless of this setting.</p>
    <p>Tick one or more files and use <strong>Add to Finishers</strong> to transfer them into the Finishers list, as if entered manually —
        typically one file of bibs and one of time splits, paired up by split number, though a single file with both is fine too.
        Selections are remembered if you navigate away and back. This is driven entirely by bibs: a bib with no matching split is
        still added, just left untimed, while any split with no matching bib is simply ignored (the bibs will catch up on a later
        sync) — and if a bib was already added untimed by an earlier run, a later run supplying the missing time fills it in rather
        than duplicating the record. Safe to repeat generally — re-adding the same file skips whatever it already added.
        Rejected if the location isn't <strong>Finish</strong>, if any bib number isn't in Entries, if the selected files aren't all
        from the same race, or if more than one bibs-recording or more than one time-recording phone is selected at once (their
        split numbers aren't comparable).</p>
    <p>The <strong>Bib Allocations</strong> tab shows, per race, a bib number / name / course list generated automatically from
        this dataset's own Entries and the Event's name and date — there's no button to press, it's kept up to date within a
        couple of seconds of any relevant edit. This is what lets a phone in Bibs or Checkpoint mode know which bib belongs to
        which course before registration has even closed. <strong>View</strong> shows the full list for a race, sorted by bib
        number. The underlying file (<code>bib-allocations.json</code>, alongside that race's device files) is public and
        needs no sign-in to fetch, so it deliberately carries only bib number, name and course — never anything else from an entry.</p>
  `,
};

export const PAGES = {
  about: `
    <p>RaceMaster is an offline-first web application for managing fell running race day operations.
       Once loaded it works without an internet connection and syncs automatically when the server is reachable.</p>
    <h3>Features</h3>
    <ul>
      <li><strong>Pre-entries</strong> — import from SportIdent / EntryCentral CSV, print pre-filled entry forms</li>
      <li><strong>Registration</strong> — on-the-day entry with automatic bib and SI card (dibber) assignment</li>
      <li><strong>Finishers</strong> — stopwatch time entry or SI dibber result import</li>
      <li><strong>Results</strong> — automatic category placing and prize list, live per-category progress tracking to judge when it's safe to do the prize presentation, CSV export, web publish</li>
      <li><strong>Safety</strong> — live outstanding / DNF / finished counts; no-show pre-entry list</li>
      <li><strong>Helpers</strong> — record volunteer names, roles, and contribution history</li>
      <li><strong>People database</strong> — persistent runner history across events</li>
      <li><strong>Paperwork</strong> — printable entry forms, finish sheets, number matrix, and A5 race bibs</li>
      <li><strong>Multi-device</strong> — conflict detection when two sessions edit the same dataset simultaneously</li>
    </ul>
    <h3>Data storage</h3>
    <p>All data is held in JSON files on the local server and cached in the browser.
       Use <em>Datasets</em> to back up, restore, or switch between events.</p>
    <h3>Feedback &amp; issues</h3>
    <p>Report problems or suggestions to the race organiser for the event.</p>
    <h3>Source code</h3>
    <p>RaceMaster is open source. The repository is at
       <a href="https://github.com/pd-giz-dave/racemaster" target="_blank" rel="noopener">github.com/pd-giz-dave/racemaster</a>.</p>
  `,

  'whats-new': `
    <h3>v0.0.11-alpha - current version</h3>
    <ul>
      <li><strong>Progress</strong> tab on Results &amp; Prize List — one row per age category, in age order, showing how many entrants have finished (retirees excluded) versus are still outstanding, to help judge when it's safe to do the prize presentation; now the first tab shown</li>
      <li>Reordered the Results tabs to Progress, Prizes, Seniors, Juniors, Pairs, Splits, Helpers</li>
      <li><strong>Export CSV</strong> now also works on the Pairs and Splits tabs (previously Seniors/Juniors only)</li>
      <li>The Seniors tab's "Top 10 average" note now explains that average is what <strong>%Ldrs</strong> is relative to (=100%); the "R = course record" hint only shows when a record has actually been broken, and sits on its own line</li>
      <li>Extended the Results and About pages' help text to cover all of the above; fixed the Results page's help text not word-wrapping (a stray CSS rule was forcing it onto one line, unlike every other page)</li>
      <li>Datasets page: Connect and Copy confirmations now appear inline next to the row you clicked instead of below the whole list, so a long dataset list never needs scrolling to see or act on them; "New dataset" and "Save As" moved to their own card, always visible rather than a button revealing a form with another button inside it; new dataset/save-as names are restricted to the same letters/numbers/hyphens as account names, and both forms clear themselves after a successful save</li>
      <li>Fixed "Connect" on the Datasets page silently pretending to succeed when the server was actually unreachable, and made every offline error on that page show consistently (title bar + bottom status bar, matching every other page) rather than only in a local corner of the page</li>
      <li>SI Results: "Clear All" now also clears the Issues tab, which previously kept showing stale entries from the last import</li>
      <li><strong>Bib Allocations</strong> tab on Mobile Files — automatically generates and publishes a per-race bib number / name / course list from the current Entries and Event (no button to press, kept up to date within a couple of seconds of any edit), so a phone in Bibs or Checkpoint mode can know which bib is on which course before registration has even closed; a "Send to Phone" action is present but not yet implemented, pending a matching change in the RaceMaster Mobile app</li>
    </ul>
    <h3>v0.0.9-alpha</h3>
    <ul>
      <li>Add <strong>Mobile Files</strong> page — lists timing data uploaded from the RaceMaster Mobile app, one row per phone, with the same Bibs/Time current-segment view the phone itself shows, plus a raw listing and delete</li>
      <li><strong>Connect to Phone…</strong> — pull a phone's history directly over Bluetooth with no network needed, for use out on the course; confirms the phone's name before connecting and rejects anything not running RaceMaster Mobile; pushes to the server if reachable, otherwise queues locally until it is</li>
      <li><strong>Add to Finishers</strong> — transfer selected mobile files straight into the Finishers list as if entered manually, pairing bibs and time splits by split number; checks location, valid bib numbers, matching race, and no conflicting phones selected; safe to re-run without duplicating, and fills in a time later if the bibs arrived first</li>
      <li>Warn before leaving the Datasets page with a sign-in that hasn't been confirmed by picking or creating a dataset yet</li>
      <li>Add a "Hide Server" testing toggle to simulate the server being unreachable, for verifying offline/field behaviour</li>
    </ul>
    <h3>v0.0.8-alpha</h3>
    <ul>
      <li>Detect 2 browser tabs open on the same dataset and let user know</li>
      <li>Prevent data loss when conflicting sessions attempt to sync the same race to the server</li>
      <li>Add dibber merge facility (so can grab a dibber set from some previous race/backup)</li>
    </ul>
    <h3>v0.0.7-alpha</h3>
    <ul>
      <li>Resolve slow bib printing</li>
      <li>Allow new names that partially match an existing name when registering entrants and helpers</li>
    </ul>
    <h3>v0.0.6-alpha</h3>
    <ul>
      <li>Add link to all results on published results pages</li>
      <li>Provide for inserting a missed time when linking finish times to bibs</li>
    </ul>
    <h3>v0.0.5-alpha</h3>
    <ul>
      <li>Add server API to accept data from the Racemaster Mobile Android app</li>
    </ul>
    <h3>v0.0.4-alpha</h3>
    <ul>
      <li>Add a custom categories facility, with import/export capabilities</li>
      <li>Add multi-role assignment to helpers</li>
      <li>Add sort capability and management facilities on the people page</li>
    </ul>
    <h3>v0.0.3-alpha/h3>
    <ul>
      <li>Add consolidated results publishing with search and sort capabilities</li>
    </ul>
    <h3>v0.0.2-alpha</h3>
    <ul>
      <li>Add pairs capability</li>
      <li>UI improvements</li>
    </ul>
    <h3>v0.0.1-alpha</h3>
    <ul>
      <li><strong>About / What's New</strong> — this page and the ? button in the header</li>
      <li><strong>Optimistic locking</strong> — version counter detects simultaneous edits; header shows version and dirty indicator</li>
      <li><strong>Safety: No-shows tab</strong> — lists pre-entries that never checked in; highlights where a same-name on-day entry exists without a pre-entry link</li>
      <li><strong>Logic / view separation</strong> — pure data functions moved to <code>js/*.js</code> files, enabling unit testing without DOM</li>
      <li><strong>Server log rotation</strong> — persistent <code>server.log</code> with automatic rotation up to <code>server.log.9</code></li>
      <li><strong>Results publishing</strong> — publish results to a public web page directly from the app</li>
      <li><strong>Schema factories</strong> — <code>createEvent()</code>, <code>createPerson()</code> etc. as single source of truth for data shapes</li>
      <li><strong>CSV alias fallback</strong> — import columns map by alias; unknown columns fall back to the field name</li>
      <li><strong>Race bibs</strong> — SVG A5 bibs printed 2-up on A4, guillotine-sorted for easy stacking</li>
    </ul>
  `,
};

export const TABLES = {
  entries: [
    { id: 'bib',     label: 'Bib',     title: 'Race number' },
    { id: 'name',    label: 'Name',    title: "Competitor's name" },
    { id: 'club',    label: 'Club',    title: 'Running club' },
    { id: 'dob',     label: 'DoB',     title: 'Date of birth' },
    { id: 'cat',     label: 'Cat',     title: 'Age category' },
    { id: 'course',  label: 'Course',  title: 'Senior or junior course' },
    { id: 'dibber',  label: 'Dibber',  title: 'SportIdent card short number' },
    { id: 'pre_no',  label: 'Pre-No',  title: 'Pre-entry reference number' },
    { id: 'actions', label: 'Actions', title: 'Edit or delete this entry' },
  ],
  helpers: [
    { id: 'number',  label: '#',       title: 'Helper number' },
    { id: 'name',    label: 'Name',    title: "Helper's name" },
    { id: 'club',    label: 'Club',    title: 'Running club' },
    { id: 'role',    label: 'Role',    title: "Helper's role" },
    { id: 'actions', label: 'Actions', title: 'Edit or delete' },
  ],
  'pre-entries': [
    { id: 'ref',           label: 'Ref',           title: 'Pre-entry reference number' },
    { id: 'name',          label: 'Name',          title: "Competitor's name" },
    { id: 'gender',        label: 'G',             title: 'Gender' },
    { id: 'dob',           label: 'DoB',           title: 'Date of birth' },
    { id: 'club',          label: 'Club',          title: 'Running club' },
    { id: 'cat',           label: 'Cat',           title: 'Age category' },
    { id: 'fra',           label: 'FRA#',          title: 'FRA registration number' },
    { id: 'si_id',         label: 'SI ID',         title: 'SportIdent member number' },
    { id: 'eligibility',   label: 'Eligibility',   title: 'Race eligibility notes' },
    { id: 'email',         label: 'Email',         title: 'Email address' },
    { id: 'addr1',         label: 'Address 1',     title: 'Address line 1' },
    { id: 'addr2',         label: 'Address 2',     title: 'Address line 2' },
    { id: 'town',          label: 'Town',          title: 'Town' },
    { id: 'county',        label: 'County',        title: 'County' },
    { id: 'postcode',      label: 'Postcode',      title: 'Postcode' },
    { id: 'country',       label: 'Country',       title: 'Country' },
    { id: 'telephone',     label: 'Telephone',     title: 'Telephone number' },
    { id: 'mobile',        label: 'Mobile',        title: 'Mobile number' },
    { id: 'emerg_contact', label: 'Emerg. Contact', title: 'Emergency contact name' },
    { id: 'emerg_tel',     label: 'Emerg. Tel',    title: 'Emergency contact telephone' },
    { id: 'medical',       label: 'Medical',       title: 'Medical information' },
    { id: 'car_reg',       label: 'Car Reg',       title: 'Car registration' },
  ],
  finishers: [
    { id: 'line',    label: 'Line',    title: 'Stopwatch split number' },
    { id: 'event',   label: 'Event',   title: 'Type of event (Finish, Start, Retire)' },
    { id: 'clock',   label: 'Clock',   title: 'Recorded time' },
    { id: 'bib',     label: 'Bib',     title: 'Race number' },
    { id: 'name',    label: 'Name',    title: "Competitor's name" },
    { id: 'cat',     label: 'Cat',     title: 'Age category' },
    { id: 'course',  label: 'Course',  title: 'Senior or junior course' },
    { id: 'actions', label: 'Actions', title: 'Edit or delete' },
  ],
  'safety-outstanding': [
    { id: 'bib',     label: 'Bib',     title: 'Race number' },
    { id: 'name',    label: 'Name',    title: "Competitor's name" },
    { id: 'course',  label: 'Course',  title: 'Senior or junior course' },
    { id: 'cat',     label: 'Cat',     title: 'Age category' },
    { id: 'actions', label: 'Actions', title: 'Mark as DNF or take action' },
  ],
  'safety-dnf': [
    { id: 'bib',     label: 'Bib',     title: 'Race number' },
    { id: 'name',    label: 'Name',    title: "Competitor's name" },
    { id: 'course',  label: 'Course',  title: 'Senior or junior course' },
    { id: 'cat',     label: 'Cat',     title: 'Age category' },
    { id: 'actions', label: 'Actions', title: 'Edit or delete' },
  ],
  'safety-finished': [
    { id: 'bib',    label: 'Bib',    title: 'Race number' },
    { id: 'name',   label: 'Name',   title: "Competitor's name" },
    { id: 'course', label: 'Course', title: 'Senior or junior course' },
    { id: 'cat',    label: 'Cat',    title: 'Age category' },
    { id: 'line',   label: 'Line',   title: 'Finishing split line number in the finishers list' },
    { id: 'time',   label: 'Time',   title: 'Finish time' },
  ],
  'safety-early': [
    { id: 'bib',        label: 'Bib',        title: 'Race number' },
    { id: 'name',       label: 'Name',       title: "Competitor's name" },
    { id: 'course',     label: 'Course',     title: 'Senior or junior course' },
    { id: 'cat',        label: 'Cat',        title: 'Age category' },
    { id: 'start_time', label: 'Start Time', title: 'Individual start time recorded for this competitor' },
  ],
  'safety-noshows': [
    { id: 'name',       label: 'Name',        title: 'Pre-entry name' },
    { id: 'dob',        label: 'DOB',         title: 'Date of birth from pre-entry' },
    { id: 'club',       label: 'Club',        title: "Competitor's club" },
    { id: 'cat',        label: 'Cat',         title: 'Age category from pre-entry' },
    { id: 'pre_no',     label: 'Pre-entry #', title: 'SI Entries participant number' },
    { id: 'on_day_bib', label: 'On-day bib',  title: 'Bib assigned if they entered on the day without linking to their pre-entry' },
  ],
  'results-progress': [
    { id: 'category',    label: 'Category',    title: 'Age category' },
    { id: 'finished',    label: 'Finished',    title: 'Entrants in this category who have finished (retirees excluded)', align: 'right' },
    { id: 'outstanding', label: 'Outstanding', title: 'Entrants in this category not yet finished or retired', align: 'right' },
  ],
  'results-senior': [
    { id: 'pos',      label: 'Pos',     title: 'Overall finishing position' },
    { id: 'bib',      label: 'Bib',     title: 'Race number' },
    { id: 'in_cat',   label: 'In Cat',  title: 'Position within age category' },
    { id: 'name',     label: 'Name',    title: "Competitor's name" },
    { id: 'club',     label: 'Club',    title: 'Running club' },
    { id: 'cat',      label: 'Cat',     title: 'Age category' },
    { id: 'time',     label: 'Time',    title: 'Finish time (R = course record)' },
    { id: 'pct_ldrs', label: '%Ldrs',   title: 'Finish time relative to the top 10 finishers’ average (that average = 100%)', align: 'right' },
    { id: 'behind',   label: 'Behind',  title: 'Time behind the leader' },
  ],
  'results-junior': [
    { id: 'bib',    label: 'Bib',    title: 'Race number' },
    { id: 'in_cat', label: 'In Cat', title: 'Position within age category' },
    { id: 'name',   label: 'Name',   title: "Competitor's name" },
    { id: 'club',   label: 'Club',   title: 'Running club' },
    { id: 'cat',    label: 'Cat',    title: 'Age category' },
    { id: 'time',   label: 'Time',   title: 'Finish time' },
  ],
  prizes: [
    { id: 'pos',    label: 'Pos',    title: 'Overall finishing position' },
    { id: 'cat',    label: 'Cat',    title: 'Age category' },
    { id: 'in_cat', label: 'In Cat', title: 'Position within age category' },
    { id: 'time',   label: 'Time',   title: 'Finish time (R = course record, J = junior)' },
    { id: 'name',   label: 'Name',   title: 'Competitor\'s name (* = winner in multiple categories)' },
  ],
  'results-helpers': [
    { id: 'role',       label: 'Role',       title: "Helper's role" },
    { id: 'name',       label: 'Name',       title: "Helper's name" },
    { id: 'club',       label: 'Club',       title: 'Running club' },
    { id: 'cat',        label: 'Cat',        title: 'Age category' },
    { id: 'last_raced', label: 'Last Raced', title: 'Date this person last competed in a race' },
  ],
  'results-pairs': [
    { id: 'pos',     label: 'Pos',      title: 'Overall finish position' },
    { id: 'bib',     label: 'Bib',      title: 'Race bib number' },
    { id: 'in_cat',  label: 'In Cat',   title: 'Position within pair category (Male/Female/Mixed, Junior/Senior)' },
    { id: 'person1', label: 'Person 1', title: 'First competitor' },
    { id: 'person2', label: 'Person 2', title: 'Second competitor' },
    { id: 'club',    label: 'Club',     title: 'Club(s)' },
    { id: 'cat',     label: 'Cat',      title: 'Pair category and gender' },
    { id: 'time',    label: 'Time',     title: 'Finish time' },
  ],
  // 'split' is a proforma — the number of splits varies by event, so it isn't a real
  // column. buildSplitsColumns() (forms/results-html.js) clones it once per split,
  // appending "_N" to id/label/title, and splices the clones in at this position.
  'results-splits': [
    { id: 'pos',         label: 'Pos',    title: 'Overall finishing position' },
    { id: 'bib',         label: 'Bib',    title: 'Race number' },
    { id: 'name',        label: 'Name',   title: "Competitor's name" },
    { id: 'cat',         label: 'Cat',    title: 'Age category' },
    { id: 'split',       label: 'CP',     title: 'Cumulative (upper) / leg (lower) time to control' },
    { id: 'finish_time', label: 'Finish', title: 'Total race time (upper) / last leg (lower) time to finish' },
  ],
  people: [
    { id: 'select',       label: '',             title: 'Select for bulk delete' },
    { id: 'name',         label: 'Name',         title: "Person's name" },
    { id: 'gender',       label: 'G',            title: 'Gender' },
    { id: 'dob',          label: 'DoB',          title: 'Date of birth' },
    { id: 'club',         label: 'Club',         title: 'Running club' },
    { id: 'fra',          label: 'FRA',          title: 'FRA registration number' },
    { id: 'last_seen',    label: 'Last Raced',   title: 'Date last registered in a race' },
    { id: 'seen',         label: 'Raced',        title: 'Number of times raced' },
    { id: 'last_helped',  label: 'Last Helped',  title: 'Date last recorded as a helper' },
    { id: 'helped',           label: 'Helped',    title: 'Number of times helped at events' },
    { id: 'last_seen_any',    label: 'Last Seen', title: 'Later of last raced and last helped — most recent contact with the club' },
    { id: 'banned_until', label: 'Banned Until', title: 'Banned from competition until this date' },
    { id: 'actions',      label: 'Actions',      title: 'Edit or delete' },
  ],
  clubs: [
    { id: 'select',    label: 'S',         title: 'Select for merge' },
    { id: 'name',      label: 'Name',      title: 'Club name' },
    { id: 'people',    label: 'People',    title: 'Number of people from this club' },
    { id: 'last_seen', label: 'Last Seen', title: 'Most recent race date for any club member' },
  ],
  roles: [
    { id: 'role',        label: 'Role',        title: 'Role name (e.g. Timekeeper, Marshal)' },
    { id: 'description', label: 'Description', title: 'Description of what this role involves' },
    { id: 'actions',     label: 'Actions',     title: 'Edit or delete' },
  ],
  categories: [
    { id: 'minAge',    label: 'MinAge',     title: 'Minimum age for this category' },
    { id: 'maleCat',   label: 'Male Cat',   title: 'Male category code (e.g. MSEN, M40)' },
    { id: 'femaleCat', label: 'Female Cat', title: 'Female category code (e.g. WSEN, W40)' },
    { id: 'ref',       label: 'Ref',        title: 'Age reference: EOY = end of race year, NOW = actual age on race date' },
    { id: 'maxDist',   label: 'MaxDist',    title: 'Maximum race distance (km) allowed for this category' },
    { id: 'actions',   label: 'Actions',    title: 'Edit or delete' },
  ],
  dibbers: [
    { id: 'short_code', label: 'Short Code', title: 'Short (3-digit) SI card number' },
    { id: 'long_code',  label: 'Long Code',  title: 'Full SI card number' },
    { id: 'owner',      label: 'Owner',      title: 'Who owns this card' },
    { id: 'lost',       label: 'Lost',       title: 'Date this dibber was lost — lost dibbers are excluded from allocation' },
    { id: 'notes',      label: 'Notes',      title: 'Additional notes' },
    { id: 'actions',    label: 'Actions',    title: 'Edit or delete' },
  ],
  'mobile-files': [
    { id: 'select',    label: '',          title: 'Select for bulk actions' },
    { id: 'owner',     label: 'Owner',     title: 'Account this file was uploaded under (admins only)' },
    { id: 'raceLabel', label: 'Race',      title: 'Race label as recorded on the phone' },
    { id: 'raceDate',  label: 'Race Date', title: 'Race date parsed from the race label' },
    { id: 'device',    label: 'Device',    title: 'Physical phone that recorded this file' },
    { id: 'location',  label: 'Location',  title: 'Course location stamped on this device\'s currently-visible lines — every line should agree' },
    { id: 'bibs',      label: 'Bibs',      title: 'Bib entries currently visible (since this device\'s last Reset)' },
    { id: 'time',      label: 'Time',      title: 'Time splits currently visible (since this device\'s last Reset)' },
    { id: 'actions',   label: 'Actions',   title: 'View, view raw, or delete this file' },
  ],
  'bib-allocations': [
    { id: 'owner',       label: 'Owner',      title: 'Account this race is recorded under (admins only)' },
    { id: 'raceLabel',   label: 'Race',       title: 'Race label this allocation was generated for' },
    { id: 'raceDate',    label: 'Race Date',  title: 'Race date parsed from the race label' },
    { id: 'bibCount',    label: 'Bibs',       title: 'Number of bib numbers allocated' },
    { id: 'generatedAt', label: 'Generated',  title: 'When this file was last generated by the web app' },
    { id: 'actions',     label: 'Actions',    title: 'View the bib/name/course list' },
  ],
};

export const GENDER = {
  FEMALE: 'Female',
  MALE:   'Male',
};

export const COURSE = {
  JUNIORS: 'Juniors',
  SENIORS: 'Seniors',
};

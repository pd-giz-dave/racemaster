'use strict';

// ----------------------------------------------------------------
// All user-visible text strings for the UI.
// Edit this file to change button tooltips and page help text.
// TOOLTIPS: element id → tooltip string (shown on hover)
// HELP:     view id   → HTML shown in the collapsible help panel
// ----------------------------------------------------------------

export const TOOLTIPS = {
  // Header
  'btn-nav-toggle':              'Open / close the navigation menu',
  'btn-select-datafile':         'Open or create an event data file',
  'btn-export-state':            'Export all event data as a JSON backup file',
  'btn-import-state':            'Import event data from a JSON backup file',
  'btn-app-update':              'A new version of RaceMaster is available — click to apply it',

  // Event settings
  'ev-name':                     'The name of the race event',
  'ev-date':                     'The date of the race',
  'ev-distance':                 'Race distance in kilometres',
  'ev-categories':               'Age category scheme — FRA uses 5-year bands, WFRA uses 10-year bands',
  'ev-first-bib':                'Bib numbers are assigned sequentially starting from this number',
  'ev-first-dibber':             'Dibber (SI card) short codes are allocated starting from this number — useful when cards 1–N are reserved or lost',
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

  // Paperwork
  'btn-print-entry-form':        'Print blank entry forms for competitors to fill in at registration',
  'btn-print-pre-entry-forms':   'Print entry forms pre-filled with pre-entry details — load pre-entries first',
  'btn-print-reg-sheet':         'Print a senior registration sheet listing all entered competitors',
  'btn-print-junior-reg-sheet':  'Print a junior registration sheet',
  'btn-print-number-matrix':     'Print a grid showing all bib numbers',
  'btn-print-finish-senior':     'Print a blank senior finish sheet for recording finish order',
  'btn-print-finish-junior':     'Print a blank junior finish sheet for recording finish order',
  'btn-print-results-senior':    'Print the formatted senior results table',
  'btn-print-results-junior':    'Print the formatted junior results table',
  'btn-print-prizes':            'Print the prize list',

  // Entries
  'btn-export-entries-si':       'Export the entry list as a CSV for importing into the SI Timing system (for when using dibbers)',
  'btn-clear-all-entries':       'Delete all entries — cannot be undone',
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

  // Pre-entries
  'btn-import-si-entries':       'Import a pre-entry CSV file from SportIdent or EntryCentral or anything that provides ?? columns',
  'btn-clear-pre-entries':       'Clear all pre-entries',

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

  // Results
  'btn-format-results':          'Calculate finishing positions, age-category places and prizes from the recorded finish times',
  'btn-print-prize-list':        'Print the prize list for the presentation',
  'btn-export-results-csv':      'Export results as a CSV spreadsheet for publication or DIY manipulation',
  'btn-publish-results':         'Publish results online',

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
  'btn-clear-dibbers':           'Delete all dibber records - cannot be undone',

  // Categories
  'btn-add-category':            'Add a new category row to the active set',
  'btn-apply-fra':               'Replace the current active categories with the FRA preset (overrides event settings)',
  'btn-apply-wfra':              'Replace the current active categories with the WFRA preset (overrides event settings)',
  'btn-reset-fra':               'Reset the FRA preset table to the built-in defaults',
  'btn-add-fra-row':             'Add a row to the FRA preset',
  'btn-reset-wfra':              'Reset the WFRA preset table to the built-in defaults',
  'btn-add-wfra-row':            'Add a row to the WFRA preset',

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
        click <strong>Select Data File</strong> in the header to open an existing event file or create a new one.</p>
    <p>Follow the <strong>Getting Started</strong> steps in order — they cover the typical workflow from setup through to results.</p>
  `,
  'view-event': `
    <p>Set up the race details before printing paperwork or registering competitors.</p> 
    <p>The <strong>distance</strong> is used to split entrants into juniors or seniors according the FRA distance rules for juniors.</p>
    <p>The <strong>category scheme</strong> (FRA 5-year or WFRA 10-year) controls which age bands are used for results and prizes.</p>
    <p>The <string>timing method</string> determines how finishers are recorded.</p> 
    <p>All fields can be updated at any point. However, be wary of the <strong>Clear all previous state</strong> checkbox, 
        which will reset all data and settings ready for a new event.</p>
  `,
  'view-forms': `
    <p>The <strong>Paperwork</strong> page provides facilities to print all the pre-race paperwork as well as some other useful forms/notices.</p>
    <p>Use <strong>Print Blank Entry Forms</strong> to generate one A4 page containing two entry forms, 
        print that as many times as required then guillotine into A5 sheets with one form per sheet.</p>
    <p>Use <strong>Print Pre-Entry Forms</strong> to generate multiple A4 pages with filled in entry forms, one for each pre-entry.
        They are generated two per A4 page in alphabetical order of surname in such a way that guillotining the whole 
        printed stack into A5 sheets maintains the order when the two half stacks are combined.</p>
    <p>The blank entry forms and the pre-filled ones have identical format and comply with FRA guidelines for both senior and junior races.</p>        
    <p>The <strong>Finish Sheets</strong> report is intended to be given to finish funnel marshals to record bib numbers as entrants cross the finish line.
        This is not necessary if dibber timing is being used but is useful as a backup (should SI Timing fail).
        The senior and junior sheets are identical, just a different number of pages created to cover the entry limits.</p>
    <p>The <strong>Number Matrix</strong> report is intended to be given to an on-course marshalls to check off runners as they pass a CP. 
        Bib numbers are always allocated sequentially, so this makes it easy to check for missing runners.</p>
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
  `,
  'view-helpers': `
    <p>Record officials, marshals and volunteers. Helpers appear in the results report as an acknowledgement of their contribution to the event.</p>
    <p>As with entries, typing a name that has been seen before will auto fill the rest of the form.</p>
    <p>Assign a <strong>role</strong> to each helper (e.g. Timekeeper, Marshal) so the report shows who did what. Roles are managed on the Roles page.</p>
  `,
  'view-finishers': `
    <p>When timing is via a stopwatch, record finishing positions and times. This is done in two stages: first record bib numbers in finishing order, 
        then in a subsequent pass assign their finishing times. The <strong>mode</strong> field determines which stage is being recorded.
        In <strong>Bibs</strong> mode fill the <strong>Race / Bib No.</strong> field and press return. 
        That bib is then recorded along with its clock split number (which auto increments) and the form reset for the next bib number.
        In <strong>Time</strong> mode enter the time the entrant crossed the finish line. 
        In this mode the form auto moves to the next record that has not got a time.</p>
    <p>In <strong>Bibs</strong> mode there are special codes that can be entered in the <strong>Race / Bib No.</strong> field.
        Select the drop-down on the field to see a list along with a brief description of each.</p> 
    <p>One particular special code is always present as Bib No. 0 - <strong>Clock</strong>: This specifes the time reference for all other times.
        If a stopwatch is being used in a conventional way the time associated with this record is 0. 
        If the stopwatch was started late (after runners had already started) the time specifies how late (up to an hour).
        If the stopwatch is being used in <strong>time-of-day</strong> mode the time specifies the time of day the stopwatch was started. 
        All subsequent times are then interpreted as time-of-day rather than split times.</p>    
    <p>This form, like entries, is very keyboard centric.</p>
    <p>If an entrant started early or late, record their individual start time by entering their BIb No and 
        checking the <strong>This is a start event</strong> option before pressing return. 
        This adds a special record where its time will be interpreted as the time the entrant actually started. 
        A subsequent finish record is also required, their elapsed time is then calculated as the difference.</p>
     <p>An entrant can also be marked as <strong>DNF</strong> (did not finish) by entering their Bib No and 
        checking the <strong>This is a retiree</strong> option before pressing return. 
        This adds a special record that indicates the entrant has finished but is excluded from the results (except as a DNF).
        These records do not get a split number.</p>
  `,
  'view-pre-entries': `
    <p>Import a pre-entry list from a CSV file. Pre-entered competitors can have their details pre-printed on entry forms from the <strong>Paperwork</strong> page.</p>
    <p>Pre-entries can be imported from any source that provides the minimum information required for entries, 
        the minimum is: entrant number, first name, last name, gender and date of birth (SI Entries and Entry Central, at least, meet this requirement).</p>
  `,
  'view-safety': `
    <p>In the <strong>Outstanding</strong> tab, shows all entrants who have <strong>not yet been recorded as finishers</strong>. 
        Use this at the end of the race to confirm that everyone is accounted for.</p>
    <p>When the list is empty, all entrants have either finished or been marked as DNF.</p>
  `,
  'view-si-results': `
    <p>Import finish times from an SI Timing (processable) results export. The import matches competitors by dibber number, then by bib number. 
        Unmatched records are shown and can be assigned manually.</p>
    <p>Run this <strong>before</strong> generating results on the <strong>Results & Prize List<strong> page. 
        You can re-import if more data arrives later.</p>
  `,
  'view-results': `
    <p>Click <strong>Generate Results</strong> to calculate finishing positions, age-category places and prizes. 
        Switch between the <strong>Seniors</strong>, <strong>Juniors</strong>, <strong>Prizes</strong> and <strong>Helpers</strong> tabs to review the output.</p>
    <p>Use <strong>Export CSV</strong> to save a results spreadsheet for publication, 
        or <strong>Print Prize List</strong> to print overall and category winners for the presentation.</p>
    <p>Use <strong>Publish Results</strong> to publish results to a website.</p>
  `,
  'view-people': `
    <p>The master database of competitors. Records here can be persisted between events so names, 
        clubs and other relevant information accumulate to facilitate auto-complete during entry registration. 
        You can search, add and edit people directly on this page.</p>
    <p>People are also added automatically when a new name is entered during race-day registration.</p>
  `,
  'view-clubs': `
    <p>The master list of clubs used for auto-complete during entry. 
        Clubs are extracted from the people list, you can also manage them here.</p>
  `,
  'view-dibbers': `
    <p>Records the dibbers available for allocation during race-day registration.
        The short-code is used during registration and mapped to its corresponding long code when exporting entries to SI Timing.</p>
    <p>Use <strong>Import CSV</strong> to import a dibber list, new short codes are added, existing ones are updated. 
        The CSV must include at least columns of "Short Code" and "Long Code".</p>
  `,
  'view-categories': `
    <p>The age categories for this event. The <strong>FRA</strong> (5-year age groups) and 
        <strong>WFRA</strong> (10-year age groups) schemes are pre-configured and selected in Event Settings.</p>
    <p>Custom categories can be added here if the standard schemes do not cover your event.</p>
  `,
  'view-roles': `
    <p>The list of helper roles (e.g. Timekeeper, Start Marshal, Registration). 
        Assign roles when recording helpers on the Helpers page so the helpers report shows who did what.</p>
    <p>Add roles here before recording helpers, or type them directly into the helpers form.</p>
  `,
};

// ----------------------------------------------------------------
// Table column definitions.
// Each entry is an array of { label, title, align? } descriptors.
// View files merge these with render functions to call renderTable().
// ----------------------------------------------------------------

export const TABLES = {
  entries: [
    { label: 'Bib',     title: 'Race number' },
    { label: 'Name',    title: "Competitor's name" },
    { label: 'Club',    title: 'Running club' },
    { label: 'DoB',     title: 'Date of birth' },
    { label: 'Cat',     title: 'Age category' },
    { label: 'Course',  title: 'Senior or junior course' },
    { label: 'Dibber',  title: 'SportIdent card short number' },
    { label: 'Pre-No',  title: 'Pre-entry reference number' },
    { label: 'Actions', title: 'Edit or delete this entry' },
  ],
  helpers: [
    { label: '#',       title: 'Helper number' },
    { label: 'Name',    title: "Helper's name" },
    { label: 'Club',    title: 'Running club' },
    { label: 'Role',    title: "Helper's role" },
    { label: 'Actions', title: 'Edit or delete' },
  ],
  'pre-entries': [
    { label: 'Ref',           title: 'Pre-entry reference number' },
    { label: 'Name',          title: "Competitor's name" },
    { label: 'G',             title: 'Gender' },
    { label: 'DoB',           title: 'Date of birth' },
    { label: 'Club',          title: 'Running club' },
    { label: 'Cat',           title: 'Age category' },
    { label: 'FRA#',          title: 'FRA registration number' },
    { label: 'SI ID',         title: 'SportIdent member number' },
    { label: 'Eligibility',   title: 'Race eligibility notes' },
    { label: 'Email',         title: 'Email address' },
    { label: 'Address 1',     title: 'Address line 1' },
    { label: 'Address 2',     title: 'Address line 2' },
    { label: 'Town',          title: 'Town' },
    { label: 'County',        title: 'County' },
    { label: 'Postcode',      title: 'Postcode' },
    { label: 'Country',       title: 'Country' },
    { label: 'Telephone',     title: 'Telephone number' },
    { label: 'Mobile',        title: 'Mobile number' },
    { label: 'Emerg. Contact', title: 'Emergency contact name' },
    { label: 'Emerg. Tel',    title: 'Emergency contact telephone' },
    { label: 'Medical',       title: 'Medical information' },
    { label: 'Car Reg',       title: 'Car registration' },
  ],
  finishers: [
    { label: 'Line',    title: 'Stopwatch split number' },
    { label: 'Event',   title: 'Type of event (Finish, Start, Retire)' },
    { label: 'Clock',   title: 'Recorded time' },
    { label: 'Bib',     title: 'Race number' },
    { label: 'Name',    title: "Competitor's name" },
    { label: 'Cat',     title: 'Age category' },
    { label: 'Course',  title: 'Senior or junior course' },
    { label: 'Actions', title: 'Edit or delete' },
  ],
  'safety-outstanding': [
    { label: 'Bib',     title: 'Race number' },
    { label: 'Name',    title: "Competitor's name" },
    { label: 'Course',  title: 'Senior or junior course' },
    { label: 'Cat',     title: 'Age category' },
    { label: 'Actions', title: 'Mark as DNF or take action' },
  ],
  'safety-dnf': [
    { label: 'Bib',     title: 'Race number' },
    { label: 'Name',    title: "Competitor's name" },
    { label: 'Course',  title: 'Senior or junior course' },
    { label: 'Cat',     title: 'Age category' },
    { label: 'Actions', title: 'Edit or delete' },
  ],
  'safety-finished': [
    { label: 'Bib',    title: 'Race number' },
    { label: 'Name',   title: "Competitor's name" },
    { label: 'Course', title: 'Senior or junior course' },
    { label: 'Cat',    title: 'Age category' },
    { label: 'Line',   title: 'Finishing split line number in the finishers list' },
    { label: 'Time',   title: 'Finish time' },
  ],
  'safety-early': [
    { label: 'Bib',        title: 'Race number' },
    { label: 'Name',       title: "Competitor's name" },
    { label: 'Course',     title: 'Senior or junior course' },
    { label: 'Cat',        title: 'Age category' },
    { label: 'Start Time', title: 'Individual start time recorded for this competitor' },
  ],
  'results-senior': [
    { label: 'Course',  title: 'Senior or junior course' },
    { label: 'Bib',     title: 'Race number' },
    { label: 'Pos',     title: 'Overall finishing position' },
    { label: 'In Cat',  title: 'Position within age category' },
    { label: 'Name',    title: "Competitor's name" },
    { label: 'Club',    title: 'Running club' },
    { label: 'Cat',     title: 'Age category' },
    { label: 'Time',    title: 'Finish time (R = course record)' },
    { label: '%Ldrs',   title: "Finish time as a percentage of the winner's time", align: 'right' },
    { label: 'Behind',  title: 'Time behind the leader' },
  ],
  'results-junior': [
    { label: 'Course', title: 'Senior or junior course' },
    { label: 'Bib',    title: 'Race number' },
    { label: 'In Cat', title: 'Position within age category' },
    { label: 'Name',   title: "Competitor's name" },
    { label: 'Club',   title: 'Running club' },
    { label: 'Cat',    title: 'Age category' },
    { label: 'Time',   title: 'Finish time' },
  ],
  prizes: [
    { label: 'Pos',    title: 'Overall finishing position' },
    { label: 'Cat',    title: 'Age category' },
    { label: 'In Cat', title: 'Position within age category' },
    { label: 'Time',   title: 'Finish time (R = course record, J = junior)' },
    { label: 'Name',   title: 'Competitor\'s name (* = winner in multiple categories)' },
  ],
  'results-helpers': [
    { label: 'Role',       title: "Helper's role" },
    { label: 'Name',       title: "Helper's name" },
    { label: 'Club',       title: 'Running club' },
    { label: 'Cat',        title: 'Age category' },
    { label: 'Last Raced', title: 'Date this person last competed in a race' },
  ],
  people: [
    { label: 'Name',         title: "Person's name" },
    { label: 'G',            title: 'Gender' },
    { label: 'DoB',          title: 'Date of birth' },
    { label: 'Club',         title: 'Running club' },
    { label: 'FRA',          title: 'FRA registration number' },
    { label: 'Last Seen',    title: 'Date last registered in a race' },
    { label: 'Seen',         title: 'Number of times raced' },
    { label: 'Last Helped',  title: 'Date last recorded as a helper' },
    { label: 'Helped',       title: 'Number of times helped at events' },
    { label: 'Banned Until', title: 'Banned from competition until this date' },
    { label: 'Actions',      title: 'Edit or delete' },
  ],
  clubs: [
    { label: 'S',         title: 'Select for merge' },
    { label: 'Name',      title: 'Club name' },
    { label: 'People',    title: 'Number of people from this club' },
    { label: 'Last Seen', title: 'Most recent race date for any club member' },
  ],
  roles: [
    { label: 'Role',        title: 'Role name (e.g. Timekeeper, Marshal)' },
    { label: 'Description', title: 'Description of what this role involves' },
    { label: 'Actions',     title: 'Edit or delete' },
  ],
  dibbers: [
    { label: 'Short Code', title: 'Short (3-digit) SI card number' },
    { label: 'Long Code',  title: 'Full SI card number' },
    { label: 'Owner',      title: 'Who owns this card' },
    { label: 'Notes',      title: 'Additional notes' },
    { label: 'Actions',    title: 'Edit or delete' },
  ],
};

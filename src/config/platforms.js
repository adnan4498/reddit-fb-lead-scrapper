const feedPlatforms = [
  {
    name: "We Work Remotely",
    type: "rss",
    url: "https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss",
    source: "We Work Remotely",
  },
  {
    name: "Remote OK",
    type: "json",
    url: "https://remoteok.com/api",
    source: "Remote OK",
  },
  {
    name: "Remotive",
    type: "json",
    url: "https://remotive.com/api/remote-jobs",
    source: "Remotive",
  },
  {
    name: "Arbeitnow",
    type: "json",
    url: "https://arbeitnow.com/api/job-board-api",
    source: "Arbeitnow",
  },
  {
    name: "Working Nomads",
    type: "rss",
    url: "https://www.workingnomads.com/jobs/rss/development",
    source: "Working Nomads",
  },
  {
    name: "Jobspresso",
    type: "rss",
    url: "https://jobspresso.co/feed/",
    source: "Jobspresso",
  },
];

const cheerioPlatforms = [
  { name: "NoDesk", url: "https://nodesk.co", scope: "global" },
  {
    name: "JustRemote",
    url: "https://justremote.co/remote-developer-jobs",
    scope: "global",
  },
  {
    name: "Remote.io",
    url: "https://www.remote.io/remote-developer-jobs",
    scope: "global",
  },
  { name: "Crunchboard", url: "https://www.crunchboard.com", scope: "global" },
  { name: "SaaSTr Job Board", url: "https://saastr.com/jobs", scope: "global" },
  {
    name: "CybersecurityJobs",
    url: "https://www.cybersecurityjobs.com",
    scope: "global",
  },
  { name: "Infosec Jobs", url: "https://infosec-jobs.com", scope: "global" },
  {
    name: "Cloud Computing Jobs",
    url: "https://cloudjobs.net",
    scope: "global",
  },
  { name: "HackerJobs", url: "https://hackerjobs.co.uk", scope: "uk" },
];

const playwrightPlatforms = [
  {
    name: "Remote.co",
    url: "https://remote.co/remote-jobs/developer/",
    scope: "global",
  },
  { name: "Pangian", url: "https://pangian.com", scope: "global" },
  { name: "PowerToFly", url: "https://powertofly.com", scope: "global" },
  { name: "Dynamite Jobs", url: "https://dynamitejobs.com", scope: "global" },
  {
    name: "Y Combinator Jobs",
    url: "https://www.ycombinator.com/jobs",
    scope: "global",
  },
  {
    name: "Techstars Job List",
    url: "https://jobs.techstars.com",
    scope: "global",
  },
];

const protectedPlatforms = [
  {
    name: "Indeed",
    baseUrl: "indeed.com",
    subdomains: ["www", "uk", "ca", "pk"],
    scope: "regional",
  },
  { name: "Glassdoor", baseUrl: "glassdoor.com", scope: "regional" },
  { name: "ZipRecruiter", baseUrl: "ziprecruiter.com", scope: "regional" },
  { name: "Wellfound", baseUrl: "wellfound.com", scope: "global" },
  { name: "Dice", baseUrl: "dice.com", scope: "us" },
  { name: "Built In", baseUrl: "builtin.com", scope: "us" },
  { name: "Monster", baseUrl: "monster.com", scope: "regional" },
  { name: "CareerBuilder", baseUrl: "careerbuilder.com", scope: "regional" },
];

const atsPlatforms = {
  greenhouse: [""],
  lever: ["lever", "geekhunter", "open-government-products"],
};

const TITLE_BLACKLIST_REGEX =
  /\b(account executive|account manager|account director|client director|business developer|sales|sdr|bdr|business development|video|video (cutter|editor)|nurse|nursing|rn|cath lab|medical|recruiter|hr manager|copywriter|marketing|seo|customer (support|service|care)|werkstudent|praktikant|ausbildung|duales studium|real estate|cashier|adjuster|teacher|instructor|professor|professeur|school|therapist|patient|pharmacist|physician|clinical|respiratory|attorney|lawyer|counsel|paralegal|legal|accountant|accounting|bookkeeper|auditor|tax|finance|financial|payroll|controller|retail|merchandiser|buyer|procurement|designer|design director|product designer|ux\/ui|ui\/ux|graphic|art director|creative director|animator|compositor|retoucher|illustrator|mechanical engineer|electrical engineer|civil engineer|manufacturing|chemical engineer|biomedical engineer|quality engineer|administrative assistant|office manager|receptionist|secretary|clerk|concierge|facility|janitor|housekeeping|property manager|leasing|driver|warehouse|logistics|supply chain|forklift|delivery|billing|claims|academic|mentor|admin|commercial manager|support engineer|field service|behavioral health|bilanzbuchhalter|buchhalter|business analyst|analyst|cam engineer|chief commercial|geschäftsführer|maintenance manager|data center technician|technician|plant operations|editorial|electronics|engagement manager|family engagement|praktikum|intern|internship|sports production|hr team|human resources|hausmeister|it audit|system administrator|sysadmin|online store|mechatroniker|mechanic|supplier security|leiter konstruktion|elektrokonstruktion|netsuite|night crew|online manager|privatkundenberater|product manager|sps-programmierer|automatisierungstechniker|project manager|projektmanager|projektleiter|crane operative|heavy equipment|hardware engineer|application scientist|working student|trade specialist|training specialist|quality|transport manager|manager|compliance|chemist|researcher|steward|ambassador|steuerberater|mitarbeiter|kundenbetreuer|fachinformatiker|teamleiter|industriemechaniker|finanzbuchhaltung|finanzbuchhalter|rechnungswesen|sachbearbeiter|assistenz|empfang|fertigungsplanung|arbeitsvorbereitung|einkauf|kaufmann|kaufmännische|initiativbewerbung|initiative application|producer|media planner|underwriting|pre-certification|vaccination|lpn|ceramics|green plants|furniture|freshness|powertrain|water treatment|dosier-|broadcast engineer|factory automation|field services|inspector|student|asset protection|data tagging|complaint coordinator|fraud investigator|talent acquisition|visual development|programme coordinator|strategic project lead|berater|prozessingenieur|produktentwickler|coordinador|vp operations|planning director|private equity|addetto|addetta|disegnatore|guardie|impiegato|manutentore|manutentrice|meccanico|operaia|operaio|orditore|orditrice|finissaggio|tessitrice|tessitore|fpga|pcie|physicist|turbogenerator|cad engineer|bios engineer|device engineer|systems bring up|developer advocate|technical artist|fx td|travel|cath lab|electrophysiology|outreach|link building|digital pr|programmatic|banco de talentos|bim specialist|design compiler|physical design|loads & dynamics|production support|requirements engineer|commissioning engineer|customer engagement|tÃ©lÃ©travail)\b|^\d+\s+|\bjobs in\b|^\$\d+|flexible (entry|remote|react|node|international|us)|open positions at|\bjobs, employment\b|\bjob vacancies\b|\bjob openings\b|\bhiring now\b/i;
const aggregatorConfig = {
  keywords: [
    "React js",
    "Full Stack Developer",
    "Mern Stack Developer",
    "Software Engineer",
    "Next js",
    "Frontend",
    "Web Developer",
    "Javascript",
    "typescript"
  ],
  regions: [
    "us",
    "gb",
    "de",
    "fr",
    "it",
    "es",
    "nl",
    "be",
    "ch",
    "at",
    "ie",
    "lu",
    "se",
    "no",
    "dk",
    "fi",
    "pl",
    "cz",
    "ro",
    "hu",
    "gr",
    "pt",
    "bg",
    "hr",
    "cy",
    "ee",
    "lv",
    "lt",
    "mt",
    "sk",
    "si",
    "is",
    "li",
    "sg",
    "my",
    "ph",
    "id",
    "th",
    "vn",
    "ae",
    "sa",
    "qa",
    "kw",
    "om",
    "bh",
    "pk",
  ],
  excludedCompanies: [
    "twilio",
    "Symmetry Digital",
    "Encode Nation",
    "Infinitum Systems",
    "Active8 Wireless",
    "stripe",
    "gitlab",
    "microsoft",
    "google",
    "amazon",
    "meta",
    "apple",
    "facebook",
    "Canva",
  ],
};

module.exports = {
  feedPlatforms,
  cheerioPlatforms,
  playwrightPlatforms,
  protectedPlatforms,
  atsPlatforms,
  TITLE_BLACKLIST_REGEX,
  aggregatorConfig,
};

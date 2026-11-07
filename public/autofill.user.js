// ==UserScript==
// @name         Auto-Fill Job Applications
// @namespace    http://tampermonkey.net/
// @version      4.4
// @description  Autofill only — no score bulb
// @match        http://*/*
// @match        https://*/*
// @include      *
// @connect      localhost
// @connect      127.0.0.1
// @connect      192.168.1.79
// @connect      *
// @grant        GM_xmlhttpRequest
// @allFrames    true
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  var API_BASE = "http://192.168.1.79:3000";
  var profileData = null;
  var isFilling = false;
  var isTopFrame = window.top === window.self;
  var DEBUG = false;

  var ATS_REGEX =
    /greenhouse\.io|lever\.co|smartrecruiters\.com|myworkdayjobs\.com|ashbyhq\.com|bamboohr\.com|breezy\.hr|applytojob\.com|workable\.com/i;

  // ── TAB THROTTLE GUARD ──
  var _audioKeepAliveCtx = null;
  function ensureAudioKeepAlive() {
    if (_audioKeepAliveCtx) return;
    try {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      var ctx = new Ctor();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.frequency.value = 440;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      _audioKeepAliveCtx = ctx;
    } catch (e) {}
  }

  // ── VALUE / OPTION MAPS ──
  var YES_NO = {
    Yes: ["yes", "y", "true", "yeah", "i do", "i have", "i am"],
    No: ["no", "n", "false", "nope", "i do not", "i don't", "i have not", "i am not", "not applicable", "n/a"],
  };

  var GENDER_MAP = {
    Male: ["male", "m", "man", "cis-man", "cis man", "cisgender man"],
    Female: ["female", "f", "woman", "cis-woman", "cis woman"],
    Other: ["other", "non-binary", "nonbinary", "gender fluid", "genderfluid", "genderqueer", "agender", "transgender", "gender diverse"],
    "Prefer not to disclose": [
      "prefer not", "decline", "decline to self-identify", "decline to identify",
      "not to say", "no answer", "choose not", "self-describe",
      "i do not wish to answer", "i don't wish to answer", "prefer not to say",
    ],
  };

  var SEX_MAP = {
    Male: ["male", "m", "man"],
    Female: ["female", "f", "woman"],
    "Prefer not to disclose": ["prefer not", "decline", "not to say", "no answer", "prefer not to say"],
  };

  var RACE_MAP = {
    "Prefer not to disclose": [
      "prefer not", "decline", "decline to self-identify", "not to say",
      "no answer", "prefer not to say", "i do not wish to answer",
    ],
    Asian: ["asian"],
    "South Asian": ["south asian"],
    "Two or More Races": ["two or more", "multiracial"],
  };

  var HISPANIC_MAP = {
    No: ["no", "not hispanic", "not latino", "decline", "prefer not"],
    Yes: ["yes", "hispanic", "latino", "latina", "latinx"],
  };

  var VETERAN_MAP = {
    "I am not a protected veteran": [
      "not a protected veteran", "i am not", "not a veteran",
      "i am not a protected veteran", "not protected", "no",
    ],
    "I identify as one or more of the classifications of a protected veteran": [
      "protected veteran", "i identify",
    ],
    "I don't wish to answer": ["wish to answer", "prefer not", "decline", "don't wish"],
  };

  var DISABILITY_MAP = {
    "No, I do not have a disability": [
      "no, i do not", "do not have", "no disability", "no, i don't",
      "i don't have", "i do not have a disability", "i don't have a disability",
      "have not had", "no, i don't have a disability", "no, i do not have a disability",
    ],
    "Yes, I have a disability": ["yes, i have", "have a disability", "had a disability", "or previously had"],
    "I do not want to answer": ["do not want", "prefer not", "decline", "don't wish", "do not wish"],
  };

  var DEGREE_MAP = {
    "Bachelor's Degree": ["bachelor", "b.s.", "bs", "b.a.", "ba", "bsc", "bscs", "bac+3", "bac+4"],
    "Master's Degree": ["master", "m.s.", "ms", "m.a.", "ma", "msc", "bac+5"],
    PhD: ["phd", "doctorate", "ph.d."],
    "Associate's Degree": ["associate", "a.a.", "aa"],
    "High School": ["high school", "secondary"],
  };

  var ENGLISH_PROFICIENCY_MAP = {
    "Native / Bilingual": [
      "native", "bilingual", "native/bilingual", "native or bilingual",
      "fluent", "mother tongue", "muttersprache", "fließend", "verhandlungssicher",
    ],
    Advanced: ["advanced", "professional", "professional working", "gute kenntnisse"],
    Intermediate: ["intermediate", "intermediate english", "grundkenntnisse"],
    Basic: ["basic", "basic english", "beginner", "keine"],
  };

  var LANGUAGE_LEVEL_MAP = {
    Native: ["native", "mother tongue", "muttersprache", "native or bilingual"],
    Fluent: ["fluent", "fließend", "fluency"],
    Advanced: ["advanced", "verhandlungssicher"],
    Intermediate: ["intermediate", "mittelstufe"],
    Basic: ["basic", "grundkenntnisse", "anfänger"],
    None: ["none", "no knowledge", "keine", "keine kenntnisse", "n/a", "non"],
  };

  var AGE_RANGE_MAP = {
    "26-40": ["26-40", "26 - 40", "26 to 40", "25-34", "26 - 35", "25 - 34"],
    "18-25": ["18-25", "18 - 25"],
    "41-54": ["41-54", "41 - 54"],
    "55+": ["55+", "55 and over"],
    "Prefer not to answer": ["prefer not", "decline", "no answer"],
  };

  var CONTRACT_TYPE_MAP = {
    "Work Contract": ["work contract", "permanent", "full time", "full-time", "employment"],
    Freelance: ["freelance", "contractor", "self-employed"],
    Other: ["other"],
  };

  var MARITAL_STATUS_MAP = {
    Single: ["single", "unmarried", "never married"],
    Married: ["married"],
    "Prefer not to disclose": ["prefer not", "decline", "no answer"],
  };

  // ── FIELD DEFINITIONS ──
  var FIELD_DEFS = [
    { id: "firstName", value: (p) => p.firstName, labels: ["first name", "given name", "given-name", "vorname", "prénom"],
      autocomplete: ["given-name"], strategies: ["text"],
      sels: ['input[name="firstName"]', 'input[name="_systemfield_firstName"]', 'input[data-testid*="firstName" i]', "#first_name", "#firstName"] },

    { id: "middleName", value: (p) => p.middleName, labels: ["middle name", "middle initial"], optional: true,
      autocomplete: ["additional-name"], strategies: ["text"] },

    { id: "lastName", value: (p) => p.lastName, labels: ["last name", "surname", "family name", "last-name", "nachname", "nom de famille"],
      autocomplete: ["family-name"], strategies: ["text"],
      sels: ['input[name="lastName"]', 'input[name="_systemfield_lastName"]', 'input[data-testid*="lastName" i]', "#last_name", "#lastName"] },

    { id: "fullName", value: (p) => p.fullName, labels: ["full name", "full-name", "your name", "name", "nom complet", "vollständiger name"],
      autocomplete: ["name"], strategies: ["text"],
      sels: ['input[name="name"]', 'input[name="fullName"]'] },

    { id: "preferredName", value: (p) => p.preferredName,
      labels: ["preferred name", "nickname", "name you'd prefer", "name you would prefer to use", "name you'd prefer us to use", "name preferred"],
      optional: true, strategies: ["text"] },

    { id: "email", value: (p) => p.email, labels: ["email", "e-mail", "email address", "e-mail address", "courriel", "e-mail adresse"],
      autocomplete: ["email"], strategies: ["text"],
      sels: ['input[type="email"]', 'input[name="email"]', 'input[name="_systemfield_email"]', "#email"] },

    { id: "emailConfirm", value: (p) => p.email, labels: ["confirm email", "verify email", "re-enter email", "email confirmation", "confirm your email", "email address confirmation"],
      strategies: ["text"],
      sels: ['input[name*="confirm" i][name*="email" i]', 'input[id*="confirm" i][id*="email" i]'] },

    { id: "phone", value: (p) => p.phone, labels: ["phone", "phone number", "mobile", "cell", "telephone", "telefon", "téléphone"],
      autocomplete: ["tel"], strategies: ["text"],
      sels: ['input[type="tel"]', 'input[name="phone"]', 'input[name="_systemfield_phone"]', "#phone"] },

    { id: "phoneDeviceType", value: (p) => p.phoneDeviceType,
      labels: ["phone device type", "device type", "phone type"],
      strategies: ["select", "radio", "buttonGroup"],
      optionMap: { Mobile: ["mobile", "cell", "smartphone", "cellular"], Landline: ["landline", "home", "office"], Work: ["work"] } },

    { id: "dateOfBirth", value: (p) => p.dateOfBirth,
      labels: ["date of birth", "dob", "birthdate", "birthday", "geburtsdatum", "date de naissance"],
      strategies: ["text", "select"] },

    { id: "dobMonth", value: (p) => p.dobMonth, labels: ["month", "birth month"], optional: true, strategies: ["select", "text"] },
    { id: "dobDay", value: (p) => p.dobDay, labels: ["day", "birth day"], optional: true, strategies: ["select", "text"] },
    { id: "dobYear", value: (p) => p.dobYear, labels: ["year", "birth year"], optional: true, strategies: ["select", "text"] },

    { id: "ageRange", value: (p) => p.ageRange, labels: ["age range", "age bracket", "age group", "what is your age"],
      strategies: ["checkboxGroup", "select", "radio", "buttonGroup"], optionMap: AGE_RANGE_MAP },

    { id: "pronouns", value: (p) => p.pronouns, labels: ["pronouns", "pronoun"], optional: true,
      strategies: ["select", "text", "radio", "buttonGroup"] },

    { id: "nationality", value: (p) => p.nationality, labels: ["nationality", "citizenship", "nationalität"],
      strategies: ["select", "text"] },

    { id: "gender", value: (p) => p.gender || p.eeoGender,
      labels: ["gender", "sex", "gender identity", "geschlecht"],
      strategies: ["select", "radio", "buttonGroup", "combobox"], optionMap: GENDER_MAP },

    { id: "sexualOrientation", value: (p) => p.sexualOrientation,
      labels: ["sexual orientation", "orientation"],
      strategies: ["select", "radio", "combobox"],
      optionMap: {
        "Prefer not to disclose": ["prefer not", "decline", "not to say", "no answer", "prefer not to say"],
        Heterosexual: ["heterosexual", "straight"],
        Other: ["other"],
      } },

    { id: "maritalStatus", value: (p) => p.maritalStatus, labels: ["marital status"],
      strategies: ["select", "radio"], optionMap: MARITAL_STATUS_MAP, optional: true },

    { id: "addressLine1", value: (p) => p.addressLine1 || p.street,
      labels: ["address", "street address", "address line 1", "street", "adresse"],
      autocomplete: ["address-line1"], strategies: ["text"] },
    { id: "addressLine2", value: (p) => p.addressLine2, labels: ["address line 2", "apt", "suite", "unit"],
      autocomplete: ["address-line2"], strategies: ["text"], optional: true },
    { id: "city", value: (p) => p.city, labels: ["city", "town", "stadt", "ville"],
      autocomplete: ["address-level2"], strategies: ["text"] },
    { id: "state", value: (p) => p.state, labels: ["state", "province", "region", "county"],
      autocomplete: ["address-level1"], strategies: ["text", "select"] },
    { id: "postalCode", value: (p) => p.postalCode || p.zip, labels: ["postal code", "zip", "zip code", "post code", "postcode", "plz"],
      autocomplete: ["postal-code"], strategies: ["text"] },
    { id: "country", value: (p) => p.country, labels: ["country", "land", "pays"],
      autocomplete: ["country-name", "country"], strategies: ["select", "text", "combobox"] },
    { id: "location", value: (p) => p.location,
      labels: ["location", "current location", "where are you based", "where are you located",
               "current country of residence", "country of residence", "where do you live",
               "current city", "residence"],
      optional: true, strategies: ["text", "select", "combobox"] },

    { id: "linkedin", value: (p) => p.linkedin,
      labels: ["linkedin", "linkedin profile", "linkedin url", "linkedin profile url"],
      strategies: ["text"] },
    { id: "github", value: (p) => p.github, labels: ["github", "github url", "github profile"],
      strategies: ["text"] },
    { id: "portfolio", value: (p) => p.portfolio, labels: ["portfolio", "portfolio url"],
      optional: true, strategies: ["text"] },
    { id: "website", value: (p) => p.website, labels: ["website", "personal website", "website url", "personal website url"],
      optional: true, strategies: ["text"] },
    { id: "twitter", value: (p) => p.twitter, labels: ["twitter", "twitter handle"], optional: true, strategies: ["text"] },

    { id: "university", value: (p) => p.university,
      labels: ["university", "college", "school", "institution", "universität"],
      strategies: ["text"] },
    { id: "fieldOfStudy", value: (p) => p.fieldOfStudy,
      labels: ["field of study", "major", "degree field", "area of study", "discipline", "fachrichtung"],
      strategies: ["text"] },
    { id: "universityStartYear", value: (p) => p.universityStartYear,
      labels: ["start year", "from year", "year started", "start date"],
      optional: true, strategies: ["text", "select"] },
    { id: "universityEndYear", value: (p) => p.universityEndYear || p.graduationYear,
      labels: ["end year", "graduation year", "year graduated", "to year", "graduation date", "date of graduation"],
      strategies: ["text", "select"] },
    { id: "gpa", value: (p) => p.gpa, labels: ["gpa", "grade point average"], optional: true, strategies: ["text"] },
    { id: "degree", value: (p) => p.highestDegree || p.degree,
      labels: ["degree", "highest degree", "education level", "highest level of education", "level of education"],
      strategies: ["select", "combobox", "text", "radio"], optionMap: DEGREE_MAP },

    { id: "currentTitle", value: (p) => p.currentTitle,
      labels: ["job title", "current title", "current position", "position title", "title", "role"],
      strategies: ["text", "select", "combobox"] },
    { id: "currentEmployer", value: (p) => p.currentEmployer,
      labels: ["current employer", "current company", "employer", "company name", "company", "most recent employer"],
      strategies: ["text"] },
    { id: "yearsExperience", value: (p) => p.yearsExperience,
      labels: ["years of experience", "total experience", "years experience", "years of professional experience",
               "years of relevant professional experience", "commercial development experience",
               "years of commercial development experience", "how many years of professional",
               "how many years of front end", "how many years of front-end", "how many years of full stack"],
      strategies: ["text", "select", "combobox"] },
    { id: "noticePeriod", value: (p) => p.noticePeriod,
      labels: ["notice period", "availability", "when can you start", "earliest start date", "available from", "when are you available", "start date"],
      strategies: ["text", "select", "combobox"] },
    { id: "expectedSalary", value: (p) => p.expectedSalary || p.desiredSalary,
      labels: ["expected salary", "salary expectation", "desired salary", "compensation expectation",
               "salary expectations", "expected compensation", "expected monthly salary",
               "what is your expected salary", "desired total compensation", "expected total compensation",
               "annual gross", "expected ctc", "salary expectations annually"],
      strategies: ["text", "select"] },
    { id: "currentSalary", value: (p) => p.currentSalary,
      labels: ["current salary", "current compensation", "current ctc"],
      optional: true, strategies: ["text"] },
    { id: "expectedSalaryRange", value: (p) => p.salaryExpectationsRange || p.salaryExpectations || "",
      labels: ["expected salary range", "salary range", "ctc range", "compensation range",
               "expected ctc range", "annual salary range"],
      strategies: ["text"] },
    { id: "salaryFrequency", value: (p) => p.salaryFrequency,
      labels: ["salary frequency"], optional: true,
      strategies: ["select", "radio"], optionMap: { Monthly: ["monthly"], Annual: ["annual", "yearly", "annually"] } },

    { id: "workAuthorization", value: (p, labelText) => {
        var t = (labelText || "").toLowerCase();
        var map = p.workAuthorizationByCountry || {};
        for (var k in map) {
          if (t.indexOf(k.toLowerCase()) !== -1) return map[k];
        }
        return p.authorizedInCountry || "Yes";
      },
      labels: ["authorized to work", "legally authorized", "work authorization", "right to work",
               "legally eligible to work", "legally permitted to work",
               "do you have a work permit", "are you eligible to work"],
      strategies: ["select", "radio", "buttonGroup", "combobox"], optionMap: YES_NO },

    { id: "requiresSponsorship", value: (p, labelText) => {
        var t = (labelText || "").toLowerCase();
        var map = p.sponsorshipByCountry || {};
        for (var k in map) {
          if (t.indexOf(k.toLowerCase()) !== -1) return map[k];
        }
        return p.requiresSponsorship || "No";
      },
      labels: ["require sponsorship", "need sponsorship", "sponsorship required", "visa sponsorship",
               "require visa sponsorship", "require sponsorship for", "sponsorship for employment",
               "require a visa", "immigration case"],
      strategies: ["select", "radio", "buttonGroup", "combobox"], optionMap: YES_NO },

    { id: "futureSponsorship", value: (p) => p.futureSponsorship || "No",
      labels: ["future sponsorship", "will you require sponsorship in the future", "in the future require"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "visaType", value: (p) => p.visaType, labels: ["visa type", "visa status", "work permit type"],
      optional: true, strategies: ["text", "select"] },

    { id: "willingToRelocate", value: (p, labelText) => {
        var t = (labelText || "").toLowerCase();
        var map = p.willingToRelocateByCountry || {};
        for (var k in map) {
          if (t.indexOf(k.toLowerCase()) !== -1) return map[k];
        }
        return p.willingToRelocate || "Depends";
      },
      labels: ["willing to relocate", "relocation", "relocate for this position",
               "willing to relocate to", "relocation assistance"],
      strategies: ["select", "radio", "buttonGroup", "combobox"],
      optionMap: { Yes: ["yes", "y"], No: ["no", "n"], Depends: ["depends", "maybe", "open to"] } },

    { id: "willingToTravel", value: (p) => p.willingToTravel || "Depends",
      labels: ["willing to travel", "travel"], strategies: ["select", "radio", "buttonGroup"],
      optionMap: { Yes: ["yes", "y"], No: ["no", "n"], Depends: ["depends", "maybe", "open to"] } },

    { id: "willingToWorkOnsite", value: (p) => p.willingToWorkOnsite || "No",
      labels: ["willing to work at least four days in the office", "willing to work onsite",
               "work regularly on-site", "regularly on-site", "regelmäßig vor Ort",
               "are you able to work on-site"],
      strategies: ["select", "radio", "buttonGroup"],
      optionMap: { Yes: ["yes", "y", "ja"], No: ["no", "n", "nein"] } },

    { id: "workPreference", value: (p) => p.workPreference || "Remote",
      labels: ["work type", "work arrangement", "work preference", "remote/hybrid/onsite", "onsite/remote",
               "preferred work arrangement", "preferred work setup"],
      strategies: ["select", "radio", "combobox", "buttonGroup"],
      optionMap: { Remote: ["remote", "telecommute", "work from home", "wfh"],
                   Hybrid: ["hybrid"], "On-site": ["onsite", "on-site", "in-person", "in office"] } },

    { id: "availableToWorkEST", value: (p) => p.availableToWorkEST || "Yes",
      labels: ["available to work 9 am - 5 pm est", "available to work est", "work during us business hours",
               "us business hours", "available to work during us"],
      strategies: ["radio", "buttonGroup", "select"], optionMap: YES_NO },

    { id: "timezonesAvailable", value: (p) => p.timezonesAvailable || ["UK", "Europe"],
      labels: ["timezones", "time zones", "which of the following timezones",
               "able to work in", "timezone overlap"],
      strategies: ["checkboxGroup"],
      optionMap: {
        US: ["us", "usa", "united states", "america", "est", "pst", "cst"],
        UK: ["uk", "united kingdom", "gmt", "bst", "london"],
        Europe: ["europe", "eu", "cet", "cest", "berlin", "paris"],
        Australia: ["australia", "aest", "sydney"],
        Asia: ["asia", "pakistan", "india", "gulf", "pkt"],
      } },

    { id: "preferredContractType", value: (p) => p.preferredContractType,
      labels: ["type of contract", "contract type", "what type of contract do you prefer",
               "preferred contract"],
      strategies: ["radio", "buttonGroup", "select"], optionMap: CONTRACT_TYPE_MAP },

    { id: "availabilityDays", value: (p) => p.availabilityDays,
      labels: ["how many days are you available", "days available", "full time or part time"],
      strategies: ["radio", "buttonGroup", "select"],
      optionMap: {
        "Full Time (6 days / week)": ["full time", "full-time", "6 days", "5 days"],
        "Full Time (5 days / week)": ["full time", "full-time", "5 days"],
        "Part-Time": ["part-time", "part time"]
      } },

    { id: "currentSector", value: (p) => p.currentSector,
      labels: ["current sector of activity", "sector of activity", "industry"],
      optional: true, strategies: ["select", "text", "combobox"] },

    { id: "jobSearchStatus", value: () => "Actively looking for a job",
      labels: ["current job situation", "job search status", "where are you in your job search",
               "are you actively looking for a job"],
      strategies: ["select", "radio", "combobox"],
      optionMap: {
        "Actively looking for a job": ["actively looking", "actively applying", "actively searching", "yes"],
        "Not looking": ["not looking", "not actively"],
        "Open to opportunities": ["open to opportunities", "open to"],
      } },

    { id: "eeoRace", value: (p) => p.eeoRace,
      labels: ["race", "ethnicity", "race/ethnicity", "how do you identify (race", "color or race",
               "please select the ethnicity", "select your race", "hispanic or latino"],
      strategies: ["select", "radio", "combobox", "buttonGroup"], optionMap: RACE_MAP },

    { id: "hispanicLatino", value: (p) => p.hispanicLatino || "No",
      labels: ["hispanic or latino", "hispanic", "latino"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: HISPANIC_MAP },

    { id: "eeoVeteran", value: (p) => p.eeoVeteran,
      labels: ["veteran", "veteran status", "protected veteran", "select your veteran status"],
      strategies: ["select", "radio", "combobox", "buttonGroup"], optionMap: VETERAN_MAP },

    { id: "eeoDisability", value: (p) => p.eeoDisability,
      labels: ["disability", "disabilities", "disability status", "physical or mental disability",
               "do you have any disabilities", "have a disability"],
      strategies: ["select", "radio", "checkboxGroup", "combobox", "buttonGroup"], optionMap: DISABILITY_MAP },

    { id: "eeoSex", value: (p) => p.sex || "Male",
      labels: ["select your sex", "sex"],
      strategies: ["select", "radio", "combobox"], optionMap: SEX_MAP },

    { id: "englishProficiency", value: (p) => p.englishProficiency || "Native / Bilingual",
      labels: ["english proficiency", "level of english", "level of proficiency in english",
               "english level", "english language level", "what is your level of english",
               "english language skills", "englischkenntnisse", "how good is your english",
               "level of knowledge in other languages", "language proficiency"],
      strategies: ["select", "radio", "checkboxGroup", "combobox", "buttonGroup"],
      optionMap: ENGLISH_PROFICIENCY_MAP },

    { id: "germanProficiency", value: (p) => p.germanProficiency || "None",
      labels: ["german proficiency", "german language skills", "deutschkenntnisse",
               "level of german", "how good is your german"],
      optional: true, strategies: ["select", "radio", "combobox"], optionMap: LANGUAGE_LEVEL_MAP },

    { id: "frenchProficiency", value: (p) => p.frenchProficiency || "None",
      labels: ["french proficiency", "french language skills", "are you fluent in french",
               "niveau de français"],
      optional: true, strategies: ["select", "radio", "combobox"],
      optionMap: { No: ["no", "non"], Yes: ["yes", "oui"], Fluent: ["fluent", "courant"] } },

    { id: "businessLanguages", value: (p) => p.businessLanguages || "English",
      labels: ["languages you are business proficient in", "business proficient in",
               "languages spoken", "languages you speak"],
      optional: true, strategies: ["text", "checkboxGroup"] },

    { id: "privacyNotice", value: () => true,
      labels: ["i have read, understand and accept", "i have read and understand",
               "you declare that you have read and understand", "you declare that you have read and agree",
               "i accept the terms of consent", "i agree to allow",
               "privacy notice", "privacy policy", "data processing consent",
               "i agree to the processing", "consent to the processing",
               "i agree to the job applications privacy notice",
               "datenschutzerklärung", "i consent to"],
      notLabels: ["newsletter", "marketing", "video for marketing", "whatsapp messages",
                  "future opportunities", "talent pool", "stay in touch"],
      strategies: ["checkbox"], optional: true },

    { id: "gdprConsent", value: () => true,
      labels: ["gdpr consent", "gdpr", "general data protection"],
      notLabels: ["newsletter", "marketing"],
      strategies: ["checkbox"], optional: true },

    { id: "newsletterConsent", value: () => false,
      labels: ["newsletter", "stay in touch", "keep me updated", "subscribe",
               "receive job opportunities", "receive these emails"],
      strategies: ["checkbox", "radio", "buttonGroup"],
      optionMap: { No: ["no", "do not", "don't", "unsubscribe"], Yes: ["yes", "keep me updated", "subscribe"] },
      optional: true },

    { id: "smsConsent", value: (p) => p.consents && p.consents.sms !== false,
      labels: ["consent to receiving sms", "sms consent", "receive sms", "consent to receive sms"],
      strategies: ["radio", "checkbox", "buttonGroup"], optionMap: YES_NO, optional: true },

    { id: "marketingVideoConsent", value: () => true,
      labels: ["video for marketing purposes", "using your video for marketing"],
      strategies: ["radio", "buttonGroup", "checkbox"], optionMap: YES_NO, optional: true },

    { id: "previouslyWorkedAt", value: (p, labelText) => {
        var t = (labelText || "").toLowerCase();
        var companies = (p.workedAtCompanies || []).map((c) => c.toLowerCase());
        for (var i = 0; i < companies.length; i++) {
          if (t.indexOf(companies[i]) !== -1) return "Yes";
        }
        return "No";
      },
      labels: ["have you previously worked", "have you ever worked for", "previously worked at",
               "have you ever been employed", "worked for any company of",
               "have you previously worked as an employee at", "have you previously worked at or consulted for",
               "worked at", "been employed by"],
      strategies: ["select", "radio", "buttonGroup", "combobox"], optionMap: YES_NO },

    { id: "familyAtCompany", value: () => "No",
      labels: ["family member or romantic partner", "friends, family members, or personal connections",
               "any current", "employee either your family"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "nonCompete", value: () => "No",
      labels: ["non-compete", "non-solicitation", "employment agreements and/or post-employment restrictions",
               "post-employment restrictions", "restrictive covenant"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "contractorViaAgency", value: () => "No",
      labels: ["performed services for", "contractor through a staffing agency", "managed service provider",
               "through a third party company or agency"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "basicJobRequirements", value: () => "Yes",
      labels: ["have at least the basic job requirements", "meet the basic job requirements",
               "do you have at least", "at least 2 years of professional experience",
               "at least 3 years", "over 3 years"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "requiredExperience2y", value: () => "Yes",
      labels: ["at least 2 years of professional experience coding on node", "at least 2 years"],
      strategies: ["radio", "buttonGroup", "select"], optionMap: YES_NO },

    { id: "previouslyKLA", value: () => "No",
      labels: ["have you been previously employed by kla", "are you a current kla employee",
               "worked at kla through a third party"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "previouslyAtCompanyDrop", value: () => "No",
      labels: ["have you previously worked at samsara", "have you previously worked at gitlab",
               "have you previously worked at morningstar", "previously worked for any company of",
               "worked at or consulted for"],
      strategies: ["select", "radio", "buttonGroup", "combobox"], optionMap: YES_NO },

    { id: "hitachiEmployee", value: () => "No",
      labels: ["currently an employee of a hitachi group company", "employee of a hitachi"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "citizenRestrictedCountry", value: () => "No",
      labels: ["citizen from one of the countries listed here", "citizen of cuba, iran, north korea, syria"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "criminalRecord", value: () => "No",
      labels: ["criminal record", "criminal conviction", "felony"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "additionalEmployment", value: () => "No",
      labels: ["plan to continue or start any additional employment", "additional employment",
               "secondary employment"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "usFederalEmployee", value: () => "No",
      labels: ["employed within the executive or legislative branch", "us federal government",
               "federal government"],
      strategies: ["radio", "buttonGroup", "select"], optionMap: YES_NO },

    { id: "availableToPerformJob", value: () => "Yes",
      labels: ["perform the essential functions of the job", "able to perform the essential functions"],
      strategies: ["radio", "buttonGroup", "select"], optionMap: YES_NO },

    { id: "previouslyAtFDJ", value: () => "No",
      labels: ["previously worked for any company of fdj"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "singaporeanPR", value: () => "No",
      labels: ["singaporean or singapore permanent resident", "singaporean"],
      strategies: ["radio", "buttonGroup", "select"], optionMap: YES_NO },

    { id: "basedInLatinAmerica", value: () => "No",
      labels: ["currently based in latin america", "based in latam"],
      strategies: ["radio", "buttonGroup", "select"], optionMap: YES_NO },

    { id: "basedInUKorPoland", value: () => "No",
      labels: ["located in either the united kingdom or poland", "based in the uk or poland"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "basedInUSorCanada", value: () => "No",
      labels: ["currently live in this location", "open to candidates in the us or canada",
               "based in the us or canada"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "fluentInFrench", value: () => "No",
      labels: ["are you fluent in french", "fluent in french"],
      strategies: ["radio", "buttonGroup", "select"], optionMap: { No: ["no", "non"], Yes: ["yes", "oui"] } },

    { id: "familiarWithCompany", value: () => "Yes",
      labels: ["were you already familiar with", "are you familiar with"],
      strategies: ["select", "radio", "buttonGroup"], optionMap: YES_NO },

    { id: "aiMatchingConsent", value: () => "Yes",
      labels: ["ai matching consent", "artificial intelligence to match", "opt out of the use of artificial intelligence",
               "ai policy for interviewers", "ai policy"],
      strategies: ["select", "radio", "buttonGroup"],
      optionMap: { Yes: ["yes", "opt-in", "opt in", "i consent", "i agree"], No: ["no", "opt-out", "opt out", "decline"] } },

    { id: "aiFrequency", value: (p) => p.aiFrequency || "Daily",
      labels: ["how frequently do you use ai", "ai tools frequency"],
      strategies: ["select", "radio", "buttonGroup"],
      optionMap: { Daily: ["daily", "every day"], Weekly: ["weekly"], Monthly: ["monthly"], Rarely: ["rarely"], Never: ["never"] } },

    { id: "aiUsageStatement", value: (p) => p.aiUsageStatement,
      labels: ["which statement best describes your current ai usage", "statement best describes"],
      strategies: ["select", "radio", "buttonGroup"] },

    { id: "videoSameEmail", value: () => "Yes",
      labels: ["submit your video using the same email", "same email you are entering",
               "video using the same email"],
      strategies: ["radio", "buttonGroup", "select"], optionMap: YES_NO },

    { id: "howDidYouHear", value: (p) => p.howDidYouHear || "LinkedIn",
      labels: ["how did you hear about us", "how did you hear about this opportunity",
               "how did you hear about", "where did you hear about", "how did you find us",
               "where have you learned about", "wie bist du auf uns aufmerksam",
               "how do you know about us", "source"],
      strategies: ["select", "combobox", "radio", "text", "buttonGroup"],
      optionMap: {
        LinkedIn: ["linkedin"],
        "Job Board": ["job board", "job portal", "job site", "indeed", "glassdoor", "online job portal", "global"],
        "Company Website": ["company website", "career site", "careers page", "career website"],
        "Social Media": ["social media", "twitter", "facebook"],
        Referral: ["referral", "referred", "employee referral"],
        "Internet Search": ["internet search", "google search", "search engine"],
      } },

    { id: "howDidYouHearDetail", value: (p) => p.howDidYouHearDetail || "LinkedIn",
      labels: ["if you know us from a job board, please share the name", "share the name"],
      optional: true, strategies: ["text"] },

    { id: "referredBy", value: () => "", labels: ["referred by", "who referred you", "referrer name"],
      optional: true, strategies: ["text"] },

    { id: "noticePeriodGerman", value: (p) => p.noticePeriodText || "Available on 7 days' notice",
      labels: ["when are you available", "available from", "verfügbar"],
      strategies: ["text", "select"] },

    { id: "expectedSalaryNumbers", value: (p, labelText) => {
        var t = (labelText || "").toLowerCase();
        if (/pln/.test(t)) return p.compYearlyPLN || "170000";
        if (/eur/.test(t)) return p.compYearlyEUR || "50000";
        if (/sgd/.test(t)) return p.compMonthlySGD || "4500";
        if (/inr/.test(t)) return "";
        if (/usd/.test(t) && /month/.test(t)) return p.compMonthlyUSD || "3500";
        if (/usd/.test(t)) return p.compMonthlyUSD || "3500";
        if (/annual|annually|per year|yearly/.test(t)) return p.compYearlyPLN || "170000";
        return p.compMonthlyUSD || "3500";
      },
      labels: ["was ist ihre jährliche gehaltserwartung", "annual gross", "expected monthly salary",
               "salary expectations (annual", "monthly salary expectation", "expected monthly compensation",
               "what are your monthly salary expectations", "what is your desired total compensation",
               "what are your salary expectations", "please provide your expected salary",
               "expected monthly compensation in usd"],
      strategies: ["text"] },

    { id: "currentMonthlySalaryLocal", value: (p) => p.currentSalary || "0",
      labels: ["current monthly salary", "what were you making in your previous role",
               "current salary in local currency"],
      optional: true, strategies: ["text"] },

    { id: "frontendYearsQuestion", value: (p) => p.frontendYears || "4",
      labels: ["how many years of front end development experience", "years of front end"],
      strategies: ["text", "select"] },

    { id: "commercialDevExperience", value: (p) => p.yearsExperience || "4",
      labels: ["years of commercial development experience", "commercial development experience"],
      strategies: ["text", "select"] },

    { id: "whyInterested", value: (p) => renderTemplate((p.longForm && p.longForm.whyInterested) || ""),
      labels: ["why are you interested", "why this role", "why do you want this position",
               "why do you want to work at", "why this role excites",
               "what excites you about this role", "what excites you"],
      strategies: ["text"] },

    { id: "tellAboutYourself", value: (p) => renderTemplate((p.longForm && p.longForm.tellAboutYourself) || ""),
      labels: ["tell us about yourself", "about yourself", "introduce yourself"],
      strategies: ["text"] },

    { id: "whyThisCompany", value: (p) => renderTemplate((p.longForm && p.longForm.whyThisCompanyTemplate) || ""),
      labels: ["why do you want to work here", "why this company", "why us", "why do you want to join"],
      strategies: ["text"] },

    { id: "coverLetter", value: (p) => renderTemplate((p.longForm && p.longForm.coverLetterTemplate) || ""),
      labels: ["cover letter", "cover letter body", "message to hiring team", "additional information"],
      strategies: ["text"] },

    { id: "challengingProject", value: (p) => renderTemplate((p.longForm && p.longForm.challengingProject) || ""),
      labels: ["challenging project", "most challenging", "hardest project"],
      strategies: ["text"] },

    { id: "mostImpactfulFrontend", value: (p) => renderTemplate((p.longForm && p.longForm.mostImpactfulFrontendFeature) || ""),
      labels: ["most impactful frontend feature", "impactful frontend",
               "feature or product you have built in the last 12 months"],
      strategies: ["text"] },

    { id: "yearsAndProjects", value: (p) => renderTemplate((p.longForm && p.longForm.yearsAndProjects) || ""),
      labels: ["how many years of professional software engineering experience do you have, and what types of projects",
               "professional software engineering experience do you have"],
      strategies: ["text"] },

    { id: "b2bSaasExperience", value: (p) => renderTemplate((p.longForm && p.longForm.b2bSaasExperience) || ""),
      labels: ["experience building products in a b2b saas", "b2b saas environment",
               "worked as a software engineer in a b2b saas"],
      strategies: ["text"] },

    { id: "frontendOwnershipStory", value: (p) => renderTemplate((p.longForm && p.longForm.frontendOwnershipStory) || ""),
      labels: ["describe a project where you took ownership of the frontend",
               "ownership of the frontend development"],
      strategies: ["text"] },

    { id: "productionFullStackProject", value: (p) => renderTemplate((p.longForm && p.longForm.productionFullStackProject) || ""),
      labels: ["production application or feature you built across both the frontend and backend",
               "describe a production application or feature"],
      strategies: ["text"] },

    { id: "nextjsReactTsExperience", value: (p) => renderTemplate((p.longForm && p.longForm.nextjsReactTsExperience) || ""),
      labels: ["tell us about your experience building applications with next.js",
               "experience building applications with next.js, react, and typescript"],
      strategies: ["text"] },

    { id: "llmIntegrationProject", value: (p) => renderTemplate((p.longForm && p.longForm.llmIntegrationProject) || ""),
      labels: ["describe a project where you integrated an llm",
               "integrated an llm or ai api into a production"],
      strategies: ["text"] },

    { id: "aiInWork", value: (p) => renderTemplate((p.longForm && p.longForm.aiInWork) || ""),
      labels: ["how do you use ai in your work"],
      strategies: ["text"] },

    { id: "aiCodingAgents", value: (p) => renderTemplate((p.longForm && p.longForm.aiCodingAgents) || ""),
      labels: ["how have you been using ai coding agents",
               "ai coding agents such as claude code, cursor"],
      strategies: ["text"] },

    { id: "aiToolsDescription", value: (p) => p.aiToolsDescription || "",
      labels: ["which ai tools do you use in your daily work",
               "which of the ai tools do you use"],
      strategies: ["text"] },

    { id: "backendScaleStory", value: (p) => renderTemplate((p.longForm && p.longForm.backendScaleStory) || ""),
      labels: ["tell us about a backend system or api you have built that had to handle significant scale",
               "backend system or api you have built"],
      strategies: ["text"] },

    { id: "debuggingStory", value: (p) => renderTemplate((p.longForm && p.longForm.debuggingStory) || ""),
      labels: ["describe a time you had to debug a production issue",
               "debug a production issue across multiple services"],
      strategies: ["text"] },

    { id: "failedProjectLesson", value: (p) => renderTemplate((p.longForm && p.longForm.failedProjectLesson) || ""),
      labels: ["describe a project or feature that failed",
               "project or feature that failed and what you learned"],
      strategies: ["text"] },

    { id: "scalableDataStructures", value: (p) => renderTemplate((p.longForm && p.longForm.scalableDataStructures) || ""),
      labels: ["highly scalable data structures", "scalable data structures"],
      strategies: ["text"] },

    { id: "anythingElse", value: (p) => renderTemplate((p.longForm && p.longForm.anythingElse) || ""),
      labels: ["anything else we should know", "anything else"],
      strategies: ["text"] },

    { id: "technicalSkills", value: (p) => p.technicalSkills || "",
      labels: ["key technical skills", "technical skills", "skills and areas of expertise"],
      strategies: ["text"] },

    { id: "languagesStacksFrameworks", value: (p) => (p.longForm && p.longForm.languagesStacksFrameworks) || p.technicalSkills || "",
      labels: ["languages, stacks, and frameworks", "languages, stacks and frameworks"],
      strategies: ["text"] },

    { id: "toolsUsed", value: (p) => p.toolsUsed || "",
      labels: ["tools, software and platforms that you have used",
               "list all of the tools, software and platforms"],
      strategies: ["text"] },

    { id: "industriesWorkedIn", value: (p) => p.industriesWorkedIn || "",
      labels: ["which industries have you worked in"],
      strategies: ["text"] },

    { id: "resume", value: (p) => p.resumeUrl,
      labels: ["resume", "cv", "curriculum vitae", "upload resume", "attach resume",
               "lebenslauf", "resume/cv"],
      strategies: ["file"] },
  ];

  // ── HELPERS ──
  function log() { if (DEBUG) console.log.apply(console, ["[Autofill]"].concat(Array.from(arguments))); }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function getPageContext() {
    var ctx = { company: "", title: "" };
    try {
      var ogSite = document.querySelector('meta[property="og:site_name"]');
      if (ogSite) ctx.company = ogSite.content.trim();
      var h1 = document.querySelector("h1");
      if (h1) ctx.title = h1.textContent.trim();
      var dt = document.title || "";
      if (!ctx.title) ctx.title = dt.split(" at ")[0].split(" | ")[0].split(" - ")[0].trim();
      if (!ctx.company) {
        var m = dt.match(/ at ([^|\-]+)/);
        if (m) ctx.company = m[1].trim();
      }
      var path = window.location.pathname;
      if (!ctx.company) {
        var m2 = path.match(/^\/([^/]+)\//);
        if (m2) ctx.company = m2[1];
      }
    } catch (e) {}
    return ctx;
  }

  function renderTemplate(tpl) {
    if (!tpl) return "";
    var ctx = getPageContext();
    return tpl
      .replace(/\{\{company\}\}/g, ctx.company || "your team")
      .replace(/\{\{title\}\}/g, ctx.title || "this position");
  }

  function querySelectorAllDeep(selector, root) {
    root = root || document;
    var out = Array.from(root.querySelectorAll(selector));
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null, false);
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (n.shadowRoot) out = out.concat(querySelectorAllDeep(selector, n.shadowRoot));
    }
    return Array.from(new Set(out));
  }

  function isVisible(el) {
    if (!el || el.type === "hidden" || el.disabled) return false;
    var s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0 || el.offsetParent !== null;
  }

  function setReactValue(el, value) {
    var proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  async function typeHuman(el, text) {
    if (!el || text == null) return;
    el.focus();
    if (document.hidden) {
      setReactValue(el, text);
      el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
      el.blur();
      return;
    }
    await sleep(10);
    setReactValue(el, "");
    var cur = "";
    for (var i = 0; i < text.length; i++) {
      cur += text[i];
      setReactValue(el, cur);
      await sleep(12 + Math.random() * 18);
    }
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.blur();
  }

  function getFieldLabelText(el) {
    try {
      if (el.id) {
        var lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lbl) return lbl.textContent.toLowerCase().trim();
      }
    } catch (e) {}
    var wrap = el.closest("label");
    if (wrap) { var wt = wrap.textContent.toLowerCase().trim(); if (wt) return wt; }
    var aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) return aria.toLowerCase().trim();
    var ariaLbl = el.getAttribute && el.getAttribute("aria-labelledby");
    if (ariaLbl) {
      var lblEl = document.getElementById(ariaLbl);
      if (lblEl) return lblEl.textContent.toLowerCase().trim();
    }
    if (el.placeholder) return el.placeholder.toLowerCase().trim();
    var cur2 = el.parentElement;
    var depth = 0;
    while (cur2 && depth < 4) {
      var txt = cur2.textContent || "";
      txt = txt.replace(/[*:\s]+/g, " ").trim().toLowerCase();
      if (txt && txt.length < 200) return txt;
      cur2 = cur2.parentElement;
      depth++;
    }
    return "";
  }

  function labelMatches(el, synonyms, notSynonyms) {
    var txt = getFieldLabelText(el);
    if (!txt) return false;
    if (notSynonyms && notSynonyms.length) {
      for (var n = 0; n < notSynonyms.length; n++) {
        if (txt.indexOf(notSynonyms[n]) !== -1) return false;
      }
    }
    for (var i = 0; i < synonyms.length; i++) {
      if (txt.indexOf(synonyms[i]) !== -1) return true;
    }
    return false;
  }

  function autocompleteMatches(el, values) {
    var ac = (el.getAttribute && el.getAttribute("autocomplete")) || "";
    ac = ac.toLowerCase();
    for (var i = 0; i < values.length; i++) if (ac.indexOf(values[i]) !== -1) return true;
    return false;
  }

  function optionMatches(optionText, synonyms) {
    var t = (optionText || "").toLowerCase().trim();
    if (!t) return false;
    for (var i = 0; i < synonyms.length; i++) {
      if (t.indexOf(synonyms[i]) !== -1) return true;
    }
    return false;
  }

  function getSynonyms(optionMap, value) {
    if (optionMap && optionMap[value]) return optionMap[value];
    return [String(value).toLowerCase()];
  }

  function getGroupLabelText(group) {
    if (!group || !group.length) return "";
    var fieldset = group[0].closest("fieldset");
    if (fieldset) {
      var legend = fieldset.querySelector("legend");
      if (legend) return (legend.textContent || "").toLowerCase().trim();
    }
    var parent = group[0].parentElement;
    var depth = 0;
    while (parent && depth < 6) {
      var lbl = parent.querySelector(':scope > legend, :scope > .label, :scope > [class*="label" i], :scope > [class*="question" i], :scope > h3, :scope > h4');
      if (lbl) return (lbl.textContent || "").toLowerCase().trim();
      var txt = (parent.textContent || "").replace(/[*:\s]+/g, " ").trim();
      if (txt && txt.length > 10 && txt.length < 320 && parent.children.length <= 6) return txt.toLowerCase();
      parent = parent.parentElement;
      depth++;
    }
    return "";
  }

  async function fillSkillBasedYesNo(profile) {
    var claims = profile.skillClaims || {};
    var skillKeys = Object.keys(claims);
    if (!skillKeys.length) return 0;
    var regexes = skillKeys.map(function (s) {
      var esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return { skill: s, re: new RegExp("(^|[^a-z0-9])" + esc + "([^a-z0-9]|$)", "i") };
    });
    var filled = 0;

    function matchSkill(labelText) {
      var t = (labelText || "").toLowerCase();
      if (!t) return null;
      if (!/(do you|have you|are you|did you|will you|can you|do u|have u|years of|experience with|proficient in|familiar with)/.test(t)) return null;
      for (var i = 0; i < regexes.length; i++) {
        if (regexes[i].re.test(t)) return claims[regexes[i].skill];
      }
      return null;
    }

    var radios = querySelectorAllDeep('input[type="radio"]');
    var radioGroups = {};
    for (var i = 0; i < radios.length; i++) {
      var r = radios[i];
      var name = r.name || "__unnamed_" + i;
      if (!radioGroups[name]) radioGroups[name] = [];
      radioGroups[name].push(r);
    }
    for (var gn in radioGroups) {
      var group = radioGroups[gn];
      if (group.some(function (x) { return x.checked; })) continue;
      var gl = getGroupLabelText(group);
      var answer = matchSkill(gl);
      if (answer !== "Yes" && answer !== "No") continue;
      var syn = YES_NO[answer];
      for (var k = 0; k < group.length; k++) {
        var optLabel = getFieldLabelText(group[k]);
        if (!optLabel) {
          var pp = group[k].parentElement;
          if (pp) optLabel = (pp.textContent || "").toLowerCase();
        }
        if (optionMatches(optLabel, syn)) {
          group[k].click();
          group[k].dispatchEvent(new Event("change", { bubbles: true }));
          filled++;
          log("Skill yes/no (radio):", gl.slice(0, 60), "→", answer);
          await sleep(40);
          break;
        }
      }
    }

    var selects = querySelectorAllDeep("select");
    for (var si = 0; si < selects.length; si++) {
      var sel = selects[si];
      if (!isVisible(sel)) continue;
      if (sel.selectedIndex > 0 && sel.value) continue;
      var opts = sel.querySelectorAll("option");
      var hasYes = false, hasNo = false;
      for (var oi = 0; oi < opts.length; oi++) {
        var ot = (opts[oi].textContent || "").toLowerCase().trim();
        if (ot === "yes" || ot === "yeah" || ot === "y" || ot === "true") hasYes = true;
        if (ot === "no" || ot === "n" || ot === "false") hasNo = true;
      }
      if (!hasYes || !hasNo) continue;
      var sl = getGroupLabelText([sel]) || getFieldLabelText(sel);
      var ans = matchSkill(sl);
      if (ans !== "Yes" && ans !== "No") continue;
      var synS = YES_NO[ans];
      for (var oj = 0; oj < opts.length; oj++) {
        var ot2 = (opts[oj].textContent || "").trim();
        if (optionMatches(ot2, synS) || ot2.toLowerCase() === ans.toLowerCase()) {
          sel.value = opts[oj].value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          sel.dispatchEvent(new Event("input", { bubbles: true }));
          filled++;
          log("Skill yes/no (select):", sl.slice(0, 60), "→", ans);
          await sleep(40);
          break;
        }
      }
    }

    var rgs = querySelectorAllDeep('[role="radiogroup"]');
    for (var gi = 0; gi < rgs.length; gi++) {
      var rg = rgs[gi];
      var btns = rg.querySelectorAll('button, [role="radio"], [role="button"]');
      if (btns.length < 2) continue;
      var already = false;
      for (var bi = 0; bi < btns.length; bi++) {
        var cls = btns[bi].className || "";
        if ((cls + "").toLowerCase().indexOf("active") !== -1 ||
            (cls + "").toLowerCase().indexOf("selected") !== -1 ||
            btns[bi].getAttribute("aria-checked") === "true") { already = true; break; }
      }
      if (already) continue;
      var rgl = getGroupLabelText([rg]) || (rg.textContent || "").toLowerCase();
      var rga = matchSkill(rgl);
      if (rga !== "Yes" && rga !== "No") continue;
      var synB = YES_NO[rga];
      for (var bj = 0; bj < btns.length; bj++) {
        var bt = (btns[bj].textContent || "").trim();
        if (optionMatches(bt, synB) || bt.toLowerCase() === rga.toLowerCase()) {
          btns[bj].click();
          filled++;
          log("Skill yes/no (button):", rgl.slice(0, 60), "→", rga);
          await sleep(40);
          break;
        }
      }
    }

    return filled;
  }

  async function fillText(def, value) {
    var inputs = querySelectorAllDeep(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]):not([type="search"]), textarea:not([readonly])'
    );
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (!isVisible(el) || el.value) continue;
      var matched = false;
      if (def.autocomplete && autocompleteMatches(el, def.autocomplete)) matched = true;
      if (!matched && labelMatches(el, def.labels, def.notLabels)) matched = true;
      if (!matched && def.sels) {
        for (var s = 0; s < def.sels.length; s++) {
          try { if (el.matches(def.sels[s])) { matched = true; break; } } catch (e) {}
        }
      }
      if (matched) {
        log("Filled text:", def.id, "→", String(value).slice(0, 40));
        await typeHuman(el, value);
        await sleep(40);
        return true;
      }
    }
    return false;
  }

  async function fillSelect(def, value, optionMap) {
    var selects = querySelectorAllDeep("select");
    for (var i = 0; i < selects.length; i++) {
      var sel = selects[i];
      if (!isVisible(sel)) continue;
      if (sel.value && sel.value !== "" && sel.value !== "0" && sel.selectedIndex > 0) continue;
      if (!labelMatches(sel, def.labels, def.notLabels)) continue;
      var synonyms = getSynonyms(optionMap, value);
      var opts = sel.querySelectorAll("option");
      for (var j = 0; j < opts.length; j++) {
        var oText = (opts[j].textContent || "").trim();
        if (!oText) continue;
        if (optionMatches(oText, synonyms) || oText.toLowerCase() === String(value).toLowerCase()) {
          sel.value = opts[j].value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          sel.dispatchEvent(new Event("input", { bubbles: true }));
          log("Selected:", def.id, "→", oText);
          await sleep(50);
          return true;
        }
      }
    }
    return false;
  }

  async function fillRadio(def, value, optionMap) {
    var radios = querySelectorAllDeep('input[type="radio"]');
    if (!radios.length) return false;
    var groups = {};
    for (var i = 0; i < radios.length; i++) {
      var r = radios[i];
      var name = r.name || "__unnamed_" + i;
      if (!groups[name]) groups[name] = [];
      groups[name].push(r);
    }
    var synonyms = getSynonyms(optionMap, value);
    for (var gname in groups) {
      var group = groups[gname];
      var groupLabelText = "";
      var fieldset = group[0].closest("fieldset");
      if (fieldset) {
        var legend = fieldset.querySelector("legend");
        if (legend) groupLabelText = legend.textContent.toLowerCase();
      }
      if (!groupLabelText) {
        var parent = group[0].parentElement;
        var depth = 0;
        while (parent && depth < 5) {
          var labelEl = parent.querySelector(':scope > legend, :scope > label, :scope > .label, :scope > [class*="label" i], :scope > [class*="question" i], :scope > [class*="title" i]');
          if (labelEl) { groupLabelText = labelEl.textContent.toLowerCase(); break; }
          parent = parent.parentElement; depth++;
        }
      }
      if (!groupLabelText) {
        var p2 = group[0].parentElement;
        var d2 = 0;
        while (p2 && d2 < 4) {
          var txt = (p2.textContent || "").replace(/[*:\s]+/g, " ").trim().toLowerCase();
          if (txt && txt.length < 300) { groupLabelText = txt; break; }
          p2 = p2.parentElement; d2++;
        }
      }
      var groupMatches = false;
      for (var li = 0; li < def.labels.length; li++) {
        if (groupLabelText.indexOf(def.labels[li]) !== -1) { groupMatches = true; break; }
      }
      if (!groupMatches) {
        for (var gix = 0; gix < group.length; gix++) {
          if (labelMatches(group[gix], def.labels, def.notLabels)) { groupMatches = true; break; }
        }
      }
      if (!groupMatches) continue;

      for (var k = 0; k < group.length; k++) {
        var radio = group[k];
        var optLabel = getFieldLabelText(radio);
        if (!optLabel) {
          var sib = radio.nextSibling;
          while (sib && sib.nodeType !== 1) sib = sib.nextSibling;
          if (sib && sib.tagName === "LABEL") optLabel = (sib.textContent || "").toLowerCase();
        }
        if (!optLabel) {
          var p = radio.parentElement;
          if (p) optLabel = (p.textContent || "").replace(/[*:\s]+/g, " ").trim().toLowerCase();
        }
        if (optionMatches(optLabel, synonyms)) {
          if (!radio.checked) {
            radio.click();
            radio.dispatchEvent(new Event("change", { bubbles: true }));
          }
          log("Radio selected:", def.id, "→", optLabel);
          await sleep(50);
          return true;
        }
      }
    }
    return false;
  }

  async function fillCheckboxGroup(def, value, optionMap) {
    var values = Array.isArray(value) ? value : [value];
    var checkboxes = querySelectorAllDeep('input[type="checkbox"]');
    if (!checkboxes.length) return false;
    var anyFilled = false;
    for (var i = 0; i < checkboxes.length; i++) {
      var cb = checkboxes[i];
      if (!isVisible(cb) || cb.checked) continue;
      var label = getFieldLabelText(cb);
      if (!label) {
        var p = cb.parentElement;
        if (p) label = (p.textContent || "").replace(/[*:\s]+/g, " ").trim().toLowerCase();
      }
      for (var v = 0; v < values.length; v++) {
        var synonyms = getSynonyms(optionMap, values[v]);
        if (optionMatches(label, synonyms)) {
          cb.click();
          cb.dispatchEvent(new Event("change", { bubbles: true }));
          anyFilled = true;
          log("Checkbox selected:", def.id, "→", label);
          await sleep(40);
          break;
        }
      }
    }
    return anyFilled;
  }

  async function fillCheckbox(def, value, optionMap) {
    if (value === false || value === "No") return false;
    var checkboxes = querySelectorAllDeep('input[type="checkbox"]');
    for (var i = 0; i < checkboxes.length; i++) {
      var cb = checkboxes[i];
      if (!isVisible(cb) || cb.checked) continue;
      var label = getFieldLabelText(cb);
      if (!label) {
        var p = cb.parentElement;
        if (p) label = (p.textContent || "").replace(/[*:\s]+/g, " ").trim().toLowerCase();
      }
      if (def.labels && !def.labels.length) continue;
      var hit = false;
      if (def.labels) {
        for (var li = 0; li < def.labels.length; li++) {
          if (label.indexOf(def.labels[li]) !== -1) { hit = true; break; }
        }
      }
      if (!hit) continue;
      if (def.notLabels) {
        var skip = false;
        for (var ni = 0; ni < def.notLabels.length; ni++) {
          if (label.indexOf(def.notLabels[ni]) !== -1) { skip = true; break; }
        }
        if (skip) continue;
      }
      cb.click();
      cb.dispatchEvent(new Event("change", { bubbles: true }));
      log("Checkbox ticked:", def.id, "→", label);
      await sleep(40);
      return true;
    }
    return false;
  }

  async function fillCombobox(def, value, optionMap) {
    var triggers = querySelectorAllDeep(
      '[role="combobox"], [class*="select" i] input, [class*="Select" i] input, .select__control, .dropdown-toggle, [aria-haspopup="listbox"]'
    );
    var synonyms = getSynonyms(optionMap, value);
    for (var i = 0; i < triggers.length; i++) {
      var trigger = triggers[i];
      if (!isVisible(trigger)) continue;
      if (!labelMatches(trigger, def.labels, def.notLabels) && !labelMatches(trigger.parentElement || trigger, def.labels, def.notLabels)) continue;
      try {
        trigger.scrollIntoView({ block: "center" });
        trigger.click();
        await sleep(200);
        var options = querySelectorAllDeep('[role="option"], [class*="option" i]:not([class*="options" i]), li[class*="option" i]');
        for (var o = 0; o < options.length; o++) {
          var opt = options[o];
          if (!isVisible(opt)) continue;
          var txt = (opt.textContent || "").trim();
          if (optionMatches(txt, synonyms) || txt.toLowerCase() === String(value).toLowerCase()) {
            opt.click();
            await sleep(120);
            log("Combobox selected:", def.id, "→", txt);
            return true;
          }
        }
        trigger.click();
        await sleep(80);
      } catch (e) {}
    }
    return false;
  }

  async function fillButtonGroup(def, value, optionMap) {
    var buttons = querySelectorAllDeep('button, [role="button"], [role="radio"], .btn, [class*="option" i]');
    if (!buttons.length) return false;
    var synonyms = getSynonyms(optionMap, value);
    var candidates = [];
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (!isVisible(b)) continue;
      var txt = (b.textContent || "").trim().toLowerCase();
      if (!txt || txt.length > 60) continue;
      if (!optionMatches(txt, synonyms)) continue;
      candidates.push(b);
    }
    for (var ci = 0; ci < candidates.length; ci++) {
      var btn = candidates[ci];
      var container = btn.closest("[class*='group' i], [class*='field' i], fieldset, [class*='question' i], [role='radiogroup']");
      if (!container) {
        container = btn.parentElement;
      }
      var ctxLabel = (container && container.textContent || "").toLowerCase();
      var groupMatch = false;
      for (var li = 0; li < def.labels.length; li++) {
        if (ctxLabel.indexOf(def.labels[li]) !== -1) { groupMatch = true; break; }
      }
      if (def.notLabels) {
        for (var ni = 0; ni < def.notLabels.length; ni++) {
          if (ctxLabel.indexOf(def.notLabels[ni]) !== -1) { groupMatch = false; break; }
        }
      }
      if (!groupMatch) continue;
      try {
        btn.scrollIntoView({ block: "center" });
        btn.click();
        await sleep(80);
        log("Button group selected:", def.id, "→", btn.textContent.trim());
        return true;
      } catch (e) {}
    }
    return false;
  }

  async function fillContentEditable(def, value) {
    var editors = querySelectorAllDeep('[contenteditable="true"]');
    for (var i = 0; i < editors.length; i++) {
      var el = editors[i];
      if (!isVisible(el) || (el.textContent || "").trim()) continue;
      if (!labelMatches(el, def.labels, def.notLabels)) continue;
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      log("ContentEditable filled:", def.id);
      await sleep(80);
      return true;
    }
    return false;
  }

  function GM_fetchBlob(url) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({ method: "GET", url: url, timeout: 20000, responseType: "blob",
        onload: function (r) { resolve(r.response); }, onerror: reject, ontimeout: reject });
    });
  }

  async function fillFile(def, resumeUrl) {
    if (!resumeUrl) return false;
    var fileInputs = querySelectorAllDeep('input[type="file"]');
    for (var i = 0; i < fileInputs.length; i++) {
      var fi = fileInputs[i];
      if (fi.files && fi.files.length > 0) continue;
      var match = labelMatches(fi, def.labels, def.notLabels) || fileInputs.length === 1;
      if (!match) continue;
      try {
        var fullUrl = resumeUrl.indexOf("http") === 0 ? resumeUrl : API_BASE + resumeUrl;
        var blob = await GM_fetchBlob(fullUrl);
        var filename = fullUrl.split("/").pop() || "resume.pdf";
        var file = new File([blob], filename, { type: "application/pdf" });
        var dt = new DataTransfer();
        dt.items.add(file);
        fi.files = dt.files;
        fi.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        log("Uploaded file:", filename);
        await sleep(600);
        return true;
      } catch (e) { console.error("[Autofill] File upload failed:", e); }
    }
    return false;
  }

  async function applyStrategy(strategy, def, value, labelText) {
    var optionMap = def.optionMap;
    switch (strategy) {
      case "text": return await fillText(def, value);
      case "select": return await fillSelect(def, value, optionMap);
      case "radio": return await fillRadio(def, value, optionMap);
      case "checkbox": return await fillCheckbox(def, value, optionMap);
      case "checkboxGroup": return await fillCheckboxGroup(def, value, optionMap);
      case "combobox": return await fillCombobox(def, value, optionMap);
      case "buttonGroup": return await fillButtonGroup(def, value, optionMap);
      case "contentEditable": return await fillContentEditable(def, value);
      case "file": return await fillFile(def, value);
      default: return false;
    }
  }

  function GM_fetchJson(url) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({ method: "GET", url: url, timeout: 10000,
        onload: function (r) { try { resolve(JSON.parse(r.responseText)); } catch (e) { reject(e); } },
        onerror: reject, ontimeout: reject });
    });
  }

  async function fillCurrentWindow() {
    try {
      if (!profileData) profileData = await GM_fetchJson(API_BASE + "/api/profile");
      var results = { filled: 0, failed: [], tried: 0 };

      try {
        var skillFilled = await fillSkillBasedYesNo(profileData);
        if (skillFilled) {
          results.filled += skillFilled;
          log("Skill yes/no answered:", skillFilled);
        }
      } catch (e) { console.error("[Autofill] Skill-based fill error:", e); }

      var waitStart = Date.now();
      var formReady = false;
      while (Date.now() - waitStart < 10000) {
        var inputs = querySelectorAllDeep('input:not([type="hidden"]):not([type="search"]):not([type="submit"]):not([type="button"])');
        var visibleCount = 0;
        for (var i = 0; i < inputs.length; i++) {
          if (isVisible(inputs[i])) visibleCount++;
          if (visibleCount >= 3) break;
        }
        if (visibleCount >= 3) { formReady = true; break; }
        await sleep(document.hidden ? 80 : 300);
      }
      if (!formReady) log("Form did not render in 10s — proceeding anyway");

      for (var i = 0; i < FIELD_DEFS.length; i++) {
        var def = FIELD_DEFS[i];
        var value;
        try {
          var labelText = "";
          if (typeof def.value === "function" && def.value.length >= 2) {
            var probe = querySelectorAllDeep('input, select, textarea, [role="combobox"], button, [role="button"]');
            for (var pi = 0; pi < probe.length; pi++) {
              if (!isVisible(probe[pi])) continue;
              if (labelMatches(probe[pi], def.labels, def.notLabels)) {
                labelText = getFieldLabelText(probe[pi]);
                break;
              }
            }
          }
          value = def.value(profileData, labelText);
        } catch (e) { value = null; }

        if (value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length)) {
          if (!def.optional) results.failed.push(def.id);
          continue;
        }

        results.tried++;
        var ok = false;
        var strategies = def.strategies || ["text"];
        for (var s = 0; s < strategies.length; s++) {
          try {
            ok = await applyStrategy(strategies[s], def, value, labelText);
            if (ok) break;
          } catch (e) {
            console.error("[Autofill] Error on", def.id, strategies[s], e);
          }
        }
        if (ok) results.filled++;
        else if (!def.optional) results.failed.push(def.id);
      }

      if (profileData.email) {
        var extraEmails = querySelectorAllDeep('input[type="email"], input[name*="email" i], input[id*="email" i]');
        for (var e = 0; e < extraEmails.length; e++) {
          if (isVisible(extraEmails[e]) && !extraEmails[e].value) {
            await typeHuman(extraEmails[e], profileData.email);
          }
        }
      }

      console.log("[Autofill] Filled:", results.filled, "/", results.tried, "| Missed:", results.failed);
      return results;
    } catch (err) {
      console.error("[Autofill] Fill error:", err);
      return { filled: 0, failed: ["FATAL: " + err.message] };
    }
  }

  function injectStyles() {
    if (!isTopFrame || document.getElementById("tm-autofill-styles")) return;
    var s = document.createElement("style");
    s.id = "tm-autofill-styles";
    s.textContent = [
      "#tm-autofill-btn { position: fixed !important; top: 15px !important; right: 15px !important; z-index: 2147483647 !important; padding: 10px 18px !important; border: none !important; border-radius: 8px !important; font-size: 14px !important; font-weight: 700 !important; cursor: pointer !important; font-family: sans-serif !important; box-shadow: 0 4px 16px rgba(0,0,0,0.3) !important; background: #6c5ce7 !important; color: #fff !important; }",
      "#tm-autofill-btn:hover { background: #5a4bd1 !important; }",
      "#tm-autofill-btn:disabled { opacity: 0.6 !important; cursor: not-allowed !important; }",
      "#tm-autofill-btn.done { background: #00b894 !important; }",
    ].join("\n");
    (document.head || document.documentElement).appendChild(s);
  }

  function ensureButton() {
    if (!isTopFrame) return;
    injectStyles();
    if (document.getElementById("tm-autofill-btn")) return;
    var b = document.createElement("button");
    b.id = "tm-autofill-btn";
    b.textContent = "🤖 Fill Form";
    b.addEventListener("click", triggerFill);
    (document.body || document.documentElement).appendChild(b);
  }

  async function triggerFill() {
    var btn = document.getElementById("tm-autofill-btn");
    if (!btn || isFilling) return;
    isFilling = true;
    btn.textContent = "⏳ Filling...";
    btn.disabled = true;
    ensureAudioKeepAlive();

    var totalFilled = 0;
    for (var pass = 0; pass < 3; pass++) {
      var r = await fillCurrentWindow();
      totalFilled += r.filled;
      window.postMessage({ type: "TM_AUTOFILL_START" }, "*");
      for (var i = 0; i < window.frames.length; i++) {
        try { window.frames[i].postMessage({ type: "TM_AUTOFILL_START" }, "*"); } catch (e) {}
      }
      if (pass < 2) await sleep(2500);
    }

    console.log("[Autofill] Total filled across passes:", totalFilled);
    btn.textContent = "✅ Done!";
    btn.classList.add("done");
    setTimeout(function () {
      btn.textContent = "🤖 Fill Form";
      btn.classList.remove("done");
      btn.disabled = false;
      isFilling = false;
    }, 2500);
  }

  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "TM_AUTOFILL_START") fillCurrentWindow();
  });

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.shiftKey && e.key === "F") {
      e.preventDefault();
      triggerFill();
    }
  });

  if (isTopFrame) {
    setInterval(ensureButton, 1000);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureButton);
    else ensureButton();
  }
})();
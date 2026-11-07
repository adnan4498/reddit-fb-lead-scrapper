function getSourceRank(url = "") {
  if (/greenhouse|lever|smartrecruiters|workday|ashbyhq|bamboohr|workable/i.test(url)) return 1;
  if (/adzuna|careerjet|jooble/i.test(url)) return 3;
  return 2;
}

module.exports = { getSourceRank };

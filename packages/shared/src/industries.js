// One industry vocabulary for every place a member's industry is written.
//
// This list previously existed twice with different values: profile editing offered 40
// options while signup offered a different 17, so signup minted variants ("Law",
// "Nonprofit") that profile editing could not display and search could not find.
//
// It is the union of both former lists plus every value already stored in production,
// so no existing profile has an industry its own editor cannot show. The near-duplicates
// that drift created (Law/Legal, Health/Healthcare) are kept deliberately: dropping one
// would orphan the profiles using it. Remapping them is a data migration, not a
// front-end change.
export const INDUSTRIES = Object.freeze([
  "Accounting",
  "Advertising",
  "Aerospace",
  "Agriculture",
  "Architecture",
  "Arts",
  "Automotive",
  "Banking",
  "Biotechnology",
  "Construction",
  "Consulting",
  "Consumer Goods",
  "Design",
  "Education",
  "Energy",
  "Engineering",
  "Entertainment",
  "Fashion",
  "Finance",
  "Food",
  "Government",
  "Health",
  "Healthcare",
  "Hospitality",
  "Insurance",
  "Journalism",
  "Law",
  "Legal",
  "Logistics",
  "Manufacturing",
  "Marketing",
  "Media",
  "Non-Profit",
  "Pharmaceuticals",
  "Private Equity",
  "Public Service",
  "Real Estate",
  "Retail",
  "Science",
  "Sports",
  "Student",
  "Technology",
  "Telecommunications",
  "Transportation",
  "Venture Capital",
  "Other"
]);

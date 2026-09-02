#!/usr/bin/env node
/**
 * Generates a demo seed for the LOCAL STAGING Cedar tenant.
 *
 * Everything it emits is fictional: names, emails, employers, bios, messages.
 * Real Camp Cedar branding (logo, background photography, the Cedar Chest
 * newsletter archive) is kept because the point of the demo is to show a real,
 * fully-dressed network. No member avatars are seeded, so every person renders
 * with the initials placeholder.
 *
 * Usage:
 *   node scripts/demo/generateCedarDemoSeed.mjs > /tmp/cedar-demo.sql
 */

const TENANT = "tenant_local_cedar";

/* ------------------------------------------------------------------ utils */

const q = (value) => `'${String(value ?? "").replace(/'/g, "''")}'`;
const jsonb = (value) => `${q(JSON.stringify(value))}::jsonb`;
const textArray = (values) =>
  values.length ? `ARRAY[${values.map(q).join(",")}]::text[]` : `ARRAY[]::text[]`;

/** 24-char hex ids, which is the shape every member-facing route validates. */
const hexId = (prefix, n) => {
  const body = n.toString(16).padStart(24 - prefix.length, "0");
  return `${prefix}${body}`;
};

const userId = (n) => hexId("ba", n);
const profileId = (n) => hexId("bb", n);
const photoId = (n) => hexId("bc", n);
const forumId = (n) => hexId("bd", n);
const postId = (n) => hexId("be", n);
const eventId = (n) => hexId("bf", n);
const convoId = (n) => hexId("ca", n);
const msgId = (n) => hexId("cb", n);
const newsletterId = (n) => hexId("cc", n);

const cityKey = (city, state) =>
  `${city}-${state}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/* ------------------------------------------------------------------ cities */

const CITIES = {
  "New York, NY": [40.7128, -74.006],
  "Brooklyn, NY": [40.6782, -73.9442],
  "Scarsdale, NY": [41.0051, -73.7846],
  "Boston, MA": [42.3601, -71.0589],
  "Cambridge, MA": [42.3736, -71.1097],
  "Newton, MA": [42.337, -71.2092],
  "Portland, ME": [43.6591, -70.2568],
  "Philadelphia, PA": [39.9526, -75.1652],
  "Pittsburgh, PA": [40.4406, -79.9959],
  "Washington, DC": [38.9072, -77.0369],
  "Bethesda, MD": [38.9847, -77.0947],
  "Chicago, IL": [41.8781, -87.6298],
  "Los Angeles, CA": [34.0522, -118.2437],
  "San Francisco, CA": [37.7749, -122.4194],
  "San Diego, CA": [32.7157, -117.1611],
  "Denver, CO": [39.7392, -104.9903],
  "Boulder, CO": [40.015, -105.2705],
  "Austin, TX": [30.2672, -97.7431],
  "Dallas, TX": [32.7767, -96.797],
  "Houston, TX": [29.7604, -95.3698],
  "Seattle, WA": [47.6062, -122.3321],
  "Miami, FL": [25.7617, -80.1918],
  "Atlanta, GA": [33.749, -84.388],
  "Nashville, TN": [36.1627, -86.7816],
  "Minneapolis, MN": [44.9778, -93.265],
  "Charlotte, NC": [35.2271, -80.8431],
  "Raleigh, NC": [35.7796, -78.6382],
  "Stamford, CT": [41.0534, -73.5387],
  "New Haven, CT": [41.3083, -72.9279],
  "Providence, RI": [41.824, -71.4128],
  "Burlington, VT": [44.4759, -73.2121],
  "Portsmouth, NH": [43.0718, -70.7626],
  "Hoboken, NJ": [40.744, -74.0324],
  "Montclair, NJ": [40.8259, -74.209],
  "Ann Arbor, MI": [42.2808, -83.743],
  "Madison, WI": [43.0731, -89.4012],
  "Salt Lake City, UT": [40.7608, -111.891],
  "Columbus, OH": [39.9612, -82.9988],
  "New Orleans, LA": [29.9511, -90.0715],
  "Phoenix, AZ": [33.4484, -112.074],
};

/* ------------------------------------------------------------------ roster */

// [first, last, city, role, gradYear, college, industry, title, company, bio]
const ROSTER = [
  ["Marc", "Ellison", "Portland, ME", "Admin", "1998", "Bowdoin College", "Education", "Camp Director", "Camp Cedar", "Cedar has been my summer home since I was a Freshman camper. Twenty-six summers and counting."],
  ["Jordan", "Whitfield", "Boston, MA", "Counselor", "2016", "Boston University", "Technology", "Senior Product Manager", "Northline Software", "Sailing instructor turned PM. Still the loudest person at the Cedar table on reunion night."],
  ["Priya", "Raghunathan", "New York, NY", "Counselor", "2015", "Cornell University", "Finance", "Vice President", "Harborline Capital", "Senior II '11. Happy to talk to any Cedar alum breaking into finance."],
  ["Daniel", "Brennan", "Brooklyn, NY", "Camper", "2019", "New York University", "Media", "Documentary Producer", "Rivertown Pictures", "Three Brennans went through Cedar. I was the one who kept losing the canoe paddles."],
  ["Maeve", "Brennan", "Cambridge, MA", "Counselor", "2017", "Tufts University", "Healthcare", "Clinical Research Lead", "Charter Health", "Waterfront staff, 2014-2017. Ask me about the polar swim."],
  ["Colm", "Brennan", "Portland, ME", "CIT", "2022", "University of Maine", "Hospitality", "Operations Coordinator", "Casco Bay Provisions", "Youngest Brennan. Still trying to beat Daniel's tetherball record."],
  ["Aisha", "Okonkwo", "Washington, DC", "Counselor", "2014", "Georgetown University", "Government", "Policy Advisor", "Office of Rep. L. Marston", "Cedar taught me how to run a meeting before I ever had a job."],
  ["Ben", "Hollander", "Scarsdale, NY", "Camper", "2008", "University of Michigan", "Real Estate", "Principal", "Hollander Property Group", "Warrior through Senior II. My kids are Cedar campers now."],
  ["Rachel", "Hollander", "Scarsdale, NY", "Counselor", "2011", "University of Wisconsin", "Marketing", "Head of Brand", "Kelso & Vance", "Ben's sister, and yes I was the better sailor."],
  ["Ethan", "Hollander", "Hoboken, NJ", "Camper", "2021", "Rutgers University", "Technology", "Software Engineer", "Basecamp Analytics", "Third-generation Cedar. My grandfather's name is on the boathouse."],
  ["Sofia", "Marchetti", "Chicago, IL", "Counselor", "2013", "Northwestern University", "Law", "Associate", "Whitmore & Fine LLP", "Arts and crafts staff who somehow became a litigator."],
  ["Tomás", "Iglesias", "Miami, FL", "Camper", "2018", "University of Florida", "Hospitality", "Restaurant Owner", "Calle Verde", "Cedar summers 2010-2016. Come eat, alumni discount applies."],
  ["Hana", "Nakamura", "San Francisco, CA", "Counselor", "2015", "Stanford University", "Technology", "Engineering Manager", "Perigee Labs", "Ran the ropes course. Now I run a platform team, which is similar."],
  ["Kenji", "Nakamura", "Seattle, WA", "Camper", "2019", "University of Washington", "Science", "Research Scientist", "Puget Bio", "Hana's little brother. Cedar 2011-2018."],
  ["Grace", "Lindqvist", "Minneapolis, MN", "Counselor", "2012", "Carleton College", "Non-Profit", "Executive Director", "North Star Youth Alliance", "Everything I know about running a program, I learned on the Cedar waterfront."],
  ["Marcus", "Delaney", "Atlanta, GA", "JC", "2020", "Emory University", "Consulting", "Senior Consultant", "Ridgeway Partners", "JC year was the best summer of my life. Fight me."],
  ["Nina", "Petrova", "Boston, MA", "Counselor", "2016", "Northeastern University", "Healthcare", "Physician Assistant", "Beacon Medical Group", "Cedar health center staff, 2014-2016."],
  ["Oliver", "Ashford", "New Haven, CT", "Camper", "2009", "Yale University", "Education", "Head of School", "Fairhaven Day", "Freshman camper in 1998. Cedar is why I went into education."],
  ["Zoe", "Ashford", "Stamford, CT", "Counselor", "2013", "Connecticut College", "Media", "Editorial Director", "Longshore Media", "Oliver's cousin. We both credit Cedar for the reading habit."],
  ["Devon", "Carrington", "Los Angeles, CA", "Counselor", "2014", "University of Southern California", "Entertainment", "Talent Manager", "Vantage Artists", "Drama shed 2010-2014. Still doing the same job, bigger budget."],
  ["Amara", "Boateng", "Philadelphia, PA", "Camper", "2017", "University of Pennsylvania", "Finance", "Investment Associate", "Schuylkill Partners", "Senior I '13. Cedar friends are still my closest friends."],
  ["Leo", "Fitzgerald", "Denver, CO", "Counselor", "2011", "Colorado College", "Architecture", "Principal Architect", "Fitzgerald Studio", "Built half the Cedar set pieces in the 2000s. Good practice."],
  ["Talia", "Rosenfeld", "Newton, MA", "Counselor", "2018", "Brandeis University", "Education", "Middle School Teacher", "Newton Country Day", "Freshman counselor forever. My campers are in college now."],
  ["Sam", "Okafor", "Houston, TX", "Camper", "2016", "Rice University", "Science", "Process Engineer", "Gulf Coast Energy", "Cedar 2008-2015, Super Warrior all the way through Senior II."],
  ["Isabelle", "Moreau", "Burlington, VT", "Counselor", "2015", "McGill University", "Non-Profit", "Program Director", "Lac Vert Outdoors", "Cedar's Canadian contingent. The lake here is colder."],
  ["Ryan", "Kowalski", "Pittsburgh, PA", "Camper", "2010", "Carnegie Mellon University", "Technology", "Director of Engineering", "Steelworks Digital", "Cedar Warrior '99. Learned to solder in the shop building."],
  ["Naomi", "Adler", "Brooklyn, NY", "Counselor", "2019", "Barnard College", "Media", "Podcast Producer", "Fenwick Audio", "Ran Cedar's radio hour. Somehow made a career of it."],
  ["Chris", "Vandenberg", "Ann Arbor, MI", "Counselor", "2012", "University of Michigan", "Healthcare", "Hospital Administrator", "Huron Valley Health", "Cedar staff 2008-2012. Best boss I ever had was 19 years old."],
  ["Layla", "Haddad", "Austin, TX", "Camper", "2020", "University of Texas", "Technology", "Data Scientist", "Longhorn Analytics", "Cedar 2012-2019. The archery range was my whole personality."],
  ["Peter", "Sandoval", "San Diego, CA", "Counselor", "2013", "UC San Diego", "Government", "City Planner", "City of San Diego", "Sailing director '11-'13."],
  ["Elena", "Vasquez", "Raleigh, NC", "Counselor", "2017", "Duke University", "Law", "Public Defender", "Wake County", "Cedar taught me to advocate for kids. Still doing it."],
  ["Jonah", "Silverstein", "Bethesda, MD", "Camper", "2015", "University of Maryland", "Finance", "Portfolio Analyst", "Potomac Asset", "Junior camper 2007. Cedar Chest cover boy, 2009."],
  ["Fiona", "Gallagher", "Providence, RI", "Counselor", "2016", "Brown University", "Science", "Marine Biologist", "Narragansett Institute", "The Cedar lake is the reason I study water for a living."],
  ["Andre", "Thompson", "Charlotte, NC", "JC", "2021", "UNC Chapel Hill", "Consulting", "Analyst", "Queen City Advisory", "JC 2018, counselor 2019. Cedar people hired me."],
  ["Mira", "Chandrasekar", "Boston, MA", "Counselor", "2014", "MIT", "Technology", "Staff Engineer", "Hollis Robotics", "Built the Cedar camp website in 2012. It was very bad."],
  ["Gabe", "Lindstrom", "Burlington, VT", "Camper", "2018", "University of Vermont", "Hospitality", "Brewery Operations", "Green Mountain Brewing", "Cedar 2010-2017."],
  ["Serena", "Whitfield", "Cambridge, MA", "Camper", "2019", "Harvard University", "Healthcare", "Medical Student", "Harvard Medical School", "Jordan's sister. Also the better sailor, for the record."],
  ["Malik", "Johnson", "Columbus, OH", "Counselor", "2012", "Ohio State University", "Education", "Athletic Director", "Franklin Prep", "Cedar athletics staff, six summers."],
  ["Claire", "Beaumont", "Portsmouth, NH", "Counselor", "2015", "University of New Hampshire", "Marketing", "Creative Director", "Seacoast Studio", "Designed the Cedar Chest masthead in 2014."],
  ["Nathan", "Weiss", "New York, NY", "Camper", "2011", "Columbia University", "Real Estate", "Development Manager", "Eastgate Realty", "Senior II '07. Reunion committee chair."],
  ["Bianca", "Ferreira", "Miami, FL", "Counselor", "2018", "University of Miami", "Marketing", "Social Media Lead", "Coastline Group", "Cedar's photographer 2015-2018. Half the Cedar Chest photos are mine."],
  ["Ivan", "Kuznetsov", "Chicago, IL", "Camper", "2013", "University of Chicago", "Finance", "Quantitative Researcher", "Lakeshore Trading", "Cedar chess champion, 2005-2009, undefeated."],
  ["Rosa", "Delgado", "Phoenix, AZ", "Counselor", "2016", "Arizona State University", "Non-Profit", "Development Manager", "Desert Futures", "Cedar 2012-2016. I fundraise now, which is just color war recruiting."],
  ["Simon", "Achebe", "Madison, WI", "Camper", "2014", "University of Wisconsin", "Science", "Environmental Consultant", "Great Lakes Environmental", "Cedar Warrior 2004."],
  ["Emily", "Hartford", "Salt Lake City, UT", "Counselor", "2017", "University of Utah", "Healthcare", "Physical Therapist", "Wasatch PT", "Cedar trip leader. Every mountain since has been easier."],
  ["Julian", "Moreau", "New Orleans, LA", "Counselor", "2013", "Tulane University", "Entertainment", "Music Director", "Crescent Sound", "Cedar's song leader, 2009-2013."],
  ["Nadia", "Rahman", "Dallas, TX", "Camper", "2019", "Southern Methodist University", "Law", "Associate", "Trinity Legal", "Cedar 2011-2018, Senior II counselor-in-training."],
  ["Owen", "Pritchard", "Boulder, CO", "Counselor", "2014", "University of Colorado", "Technology", "Founder", "Flatiron Tools", "Cedar taught me how to build something with a deadline of Friday."],
  ["Lily", "Tanaka", "Los Angeles, CA", "Camper", "2020", "UCLA", "Entertainment", "Assistant Editor", "Silverlake Post", "Cedar 2012-2019."],
  ["Gideon", "Marsh", "Portland, ME", "Admin", "2005", "Colby College", "Education", "Assistant Director", "Camp Cedar", "Year-round Cedar staff. If you emailed the camp, you emailed me."],
  ["Harriet", "Okonjo", "Atlanta, GA", "Counselor", "2018", "Spelman College", "Consulting", "Strategy Manager", "Peachtree Consulting", "Cedar dance program, 2014-2018."],
  ["Felix", "Braun", "Seattle, WA", "Camper", "2012", "University of Washington", "Technology", "Principal Engineer", "Rainier Systems", "Cedar 2002-2010."],
  ["Camille", "Dubois", "Washington, DC", "Counselor", "2016", "American University", "Government", "Foreign Service Officer", "U.S. Department of State", "Cedar's international staff coordinator."],
  ["Theo", "Papadakis", "New York, NY", "Camper", "2017", "Fordham University", "Media", "Sports Reporter", "Metro Sports Daily", "Cedar color war general, 2013. Still undefeated."],
  ["Ruth", "Feingold", "Newton, MA", "Counselor", "2010", "Wellesley College", "Non-Profit", "Grants Director", "Commonwealth Fund for Youth", "Cedar 2004-2010, Freshman village head."],
  ["Xavier", "Cole", "Nashville, TN", "Counselor", "2015", "Vanderbilt University", "Entertainment", "A&R Manager", "Music Row Records", "Cedar talent show host, four years running."],
  ["Anya", "Sokolova", "Brooklyn, NY", "Camper", "2018", "Pratt Institute", "Architecture", "Designer", "Fifth Street Architects", "Cedar arts shed, all day, every day."],
  ["Reuben", "Katz", "Montclair, NJ", "Camper", "2009", "Rutgers University", "Real Estate", "Broker", "Essex County Realty", "Cedar 1999-2007. My whole bunk still texts daily."],
  ["Delphine", "Laurent", "San Francisco, CA", "Counselor", "2019", "UC Berkeley", "Technology", "Product Designer", "Meridian Design", "Cedar 2015-2019, waterfront and art."],
  ["Hugo", "Mancini", "Denver, CO", "Camper", "2016", "Colorado State University", "Hospitality", "General Manager", "Alpine Lodge", "Cedar 2008-2015."],
  ["Josephine", "Adeyemi", "Chicago, IL", "Counselor", "2017", "DePaul University", "Education", "Curriculum Designer", "Learnwell", "Cedar's Super Warrior counselor. Hardest and best job there is."],
];

/* ------------------------------------------------------------------ people */

const people = ROSTER.map((row, index) => {
  const [first, last, cityState, role, gradYear, college, industry, title, company, bio] = row;
  const n = index + 1;
  const emailLocal = `${first}.${last}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z.]/g, "");
  return {
    n,
    userId: userId(n),
    profileId: profileId(n),
    identityId: `identity_demo_cedar_${n}`,
    membershipId: `membership_demo_cedar_${n}`,
    first,
    last,
    name: `${first} ${last}`,
    email: `${emailLocal}@cedar.example.test`,
    cityState,
    role,
    gradYear,
    college,
    industry,
    title,
    company,
    bio,
    isAdmin: role === "Admin",
    // 555-01xx is the reserved fictional range, so these can never dial anyone.
    phone: `(${["207", "617", "212", "312", "415"][index % 5]}) 555-${String(100 + index).padStart(4, "0")}`,
    highSchool: `${cityState.split(", ")[0]} High School`,
  };
});

const byName = (name) => people.find((p) => p.name === name);

/* ------------------------------------------------------------------- print */

const out = [];
const w = (line = "") => out.push(line);

w("-- Camp Cedar outreach demo seed (LOCAL STAGING ONLY).");
w("-- Fictional people, real Cedar branding, no member avatars.");
w("BEGIN;");
w();

/* --- tenant branding ---------------------------------------------------- */

const content = {
  campType: "coed",
  networkDisplayName: "Camp Cedar Alumni Network",
  welcomeHeadline: "Welcome back to Cedar.",
  welcomeBody:
    "Every summer on the lake, every bunk, every color war — all of it lives here. Find the people you grew up with, see where they landed, and keep the Cedar community going year-round.",
  aboutText:
    "The Camp Cedar Alumni Network connects generations of Cedar campers, counselors, and staff. Search the directory, browse the map, read every issue of the Cedar Chest, and stay in touch between summers.",
  contactEmail: "alumni@campcedar.example.test",
  newsletterName: "Cedar Chest",
  aiAssistantName: "Cedar AI",
  staffRoles: ["Camper", "Counselor", "JC", "CIT", "Admin"],
  ageGroups: [
    "Super Warrior", "Warrior", "Freshman", "Sophomore",
    "Junior", "Intermediate", "Senior I", "Senior II",
  ],
  supportUrl: "",
  footerLinks: [],
};

w("UPDATE public.tenants SET");
w(`  name = ${q("Camp Cedar")},`);
w(`  content = ${jsonb(content)},`);
w(`  modules = ${jsonb({
  directory: true, search: true, photoStream: true, chat: true, map: true,
  familyTrees: true, relatedProfiles: true, newsletter: true, merchShop: false,
})}`);
w(`WHERE id = ${q(TENANT)};`);
w();

/* --- retire the three placeholder staging profiles ---------------------- */

w("-- The stock staging accounts are replaced by the demo roster below.");
w(`DELETE FROM public.event_rsvps WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.messages WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.conversations WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.forum_posts WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.forums WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.events WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.activity_items WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.photos WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.family_trees WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.newsletters WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.mobile_notifications WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.mobile_notification_preferences WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.alumni_contacts WHERE tenant_id = ${q(TENANT)};`);
w(`UPDATE public.users SET profile_id = NULL WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.profiles WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.tenant_memberships WHERE tenant_id = ${q(TENANT)};`);
w(`DELETE FROM public.identities WHERE id IN (
  'identity_local_cedar_admin','identity_local_cedar_member_1','identity_local_cedar_member_2'
) OR id LIKE 'identity_demo_cedar_%';`);
w(`DELETE FROM public.city_geo WHERE source = 'demo_seed';`);
w(`DELETE FROM public.users WHERE tenant_id = ${q(TENANT)};`);
w();

/* --- users -------------------------------------------------------------- */

// bcrypt digest of "Pondbridge123!", reused from the canonical staging seed.
const PASSWORD_HASH = "$2a$10$jS4oqIRVjrED596U9KAoQebo9TogTPAKKktwwhk.F1akWpqJoLzvu";

// Join dates fan out from ~18 months ago to this week; users and profiles must
// agree, because the dashboard reads growth from users and completion from
// profiles.
const joinedDaysAgo = (index) => Math.max(1, 540 - index * 9);

w("INSERT INTO public.users (id, tenant_id, email, password_hash, roles, status, profile_id, created_at) VALUES");
w(
  people
    .map(
      (p, i) =>
        `  (${q(p.userId)}, ${q(TENANT)}, ${q(p.email)}, ${q(PASSWORD_HASH)}, ` +
        `ARRAY[${p.isAdmin ? "'tenant_admin','user'" : "'user'"}], 'active', ${q(p.profileId)}, ` +
        `now() - interval '${joinedDaysAgo(i)} days')`
    )
    .join(",\n") + ";"
);
w();

w("INSERT INTO public.identities (id, primary_email, verified_emails, status, metadata) VALUES");
w(
  people
    .map(
      (p) =>
        `  (${q(p.identityId)}, ${q(p.email)}, ARRAY[${q(p.email)}], 'active', ` +
        `${jsonb({ synthetic: true, demo: true })})`
    )
    .join(",\n") + ";"
);
w();

w("INSERT INTO public.tenant_memberships (id, tenant_id, identity_id, legacy_user_id, roles, status, join_method) VALUES");
w(
  people
    .map(
      (p) =>
        `  (${q(p.membershipId)}, ${q(TENANT)}, ${q(p.identityId)}, ${q(p.userId)}, ` +
        `ARRAY[${p.isAdmin ? "'tenant_admin','user'" : "'user'"}], 'active', 'admin_created')`
    )
    .join(",\n") + ";"
);
w();

/* --- profiles ----------------------------------------------------------- */

w(`INSERT INTO public.profiles (
  id, tenant_id, user_id, tenant_membership_id, first_name, last_name, emails, phones,
  city_state, role_at_camp, high_school, colleges, college_years, current_jobs, past_jobs,
  industry, socials, privacy, avatar_url, bio, status, created_at
) VALUES`);
w(
  people
    .map((p, i) => {
      const currentJobs = [{ role: p.title, company: p.company, years: `${Number(p.gradYear) + 3}-Present` }];
      const pastJobs = p.isAdmin
        ? []
        : [{ role: p.role === "Camper" ? "Camper" : p.role, company: "Camp Cedar", years: `${Number(p.gradYear) - 8}-${Number(p.gradYear)}` }];
      return (
        `  (${q(p.profileId)}, ${q(TENANT)}, ${q(p.userId)}, ${q(p.membershipId)}, ` +
        `${q(p.first)}, ${q(p.last)}, ARRAY[${q(p.email)}], ARRAY[${q(p.phone)}], ` +
        `${q(p.cityState)}, ${q(p.role)}, ${q(p.highSchool)}, ` +
        `ARRAY[${q(p.college)}], ARRAY[${q(p.gradYear)}], ${jsonb(currentJobs)}, ${jsonb(pastJobs)}, ` +
        `${q(p.industry)}, ${jsonb({ linkedin: `https://www.linkedin.com/in/${p.first.toLowerCase()}-${p.last.toLowerCase()}-cedar` })}, ` +
        `${jsonb({ email: "members", phone: "private" })}, '', ${q(p.bio)}, 'active', ` +
        `now() - interval '${joinedDaysAgo(i)} days')`
      );
    })
    .join(",\n") + ";"
);
w();

/* --- city geo ----------------------------------------------------------- */

const usedCities = [...new Set(people.map((p) => p.cityState))];
w("INSERT INTO public.city_geo (id, key, city, state, country, lat, lng, source) VALUES");
w(
  usedCities
    .map((cityState, i) => {
      const [city, state] = cityState.split(", ");
      const coords = CITIES[cityState];
      if (!coords) throw new Error(`Missing coordinates for ${cityState}`);
      return (
        `  (${q(`citygeo_demo_${i + 1}`)}, ${q(cityKey(city, state))}, ${q(city)}, ${q(state)}, ` +
        `'US', ${coords[0]}, ${coords[1]}, 'demo_seed')`
      );
    })
    .join(",\n") + "\nON CONFLICT (key) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng;"
);
w();

/* --- photo stream ------------------------------------------------------- */

const PHOTOS = [
  ["2024-Fall-Cedar-Chest-cover.jpg", "Sunset off the main dock. Some things never change.", "Bianca Ferreira", 34],
  ["2023-Spring-Cedar-Chest-cover.jpg", "Opening day, waterfront ready. 2024 season is a go.", "Gideon Marsh", 51],
  ["2022-Winter-Cedar-Chest-cover.jpg", "Last night of camp, from the sailing dock.", "Delphine Laurent", 47],
  ["2024-Spring-Cedar-Chest-cover.jpg", "Back at the lake for alumni weekend.", "Nathan Weiss", 28],
  ["2020-Fall-Cedar-Chest-cover.jpg", "Morning swim, still the best part of the day.", "Fiona Gallagher", 19],
  ["2022-Spring-Cedar-Chest-cover.jpg", "The lake in June. Nothing else looks like this.", "Claire Beaumont", 41],
  ["2023-Fall-Cedar-Chest-cover.jpg", "Reunion weekend. Forty of us made it back.", "Marc Ellison", 88],
  ["2024-Winter-Cedar-Chest-cover.jpg", "Cedar in the off-season. Quiet, but it's still there.", "Gideon Marsh", 23],
  ["2020-Winter-Cedar-Chest-cover.jpg", "Boathouse at first light.", "Leo Fitzgerald", 30],
  ["2022-Fall-Cedar-Chest-cover.jpg", "Color war closing ceremony, from the hill.", "Theo Papadakis", 55],
];

w("INSERT INTO public.photos (id, tenant_id, owner_id, owner_name, image_url, thumb_url, caption, likes, comments, created_at) VALUES");
w(
  PHOTOS.map(([file, caption, ownerName, likeCount], i) => {
    const owner = byName(ownerName);
    if (!owner) throw new Error(`Unknown photo owner ${ownerName}`);
    const likers = people.slice(0, likeCount % people.length).map((p) => p.userId);
    const comments = i % 3 === 0
      ? [{
          _id: hexId("cd", i + 1),
          authorId: people[(i + 7) % people.length].userId,
          authorName: people[(i + 7) % people.length].name,
          text: "This is exactly how I remember it.",
          createdAt: new Date(Date.now() - i * 86400000).toISOString(),
        }]
      : [];
    return (
      `  (${q(photoId(i + 1))}, ${q(TENANT)}, ${q(owner.userId)}, ${q(owner.name)}, ` +
      `${q(`/demo/${file}`)}, ${q(`/demo/${file}`)}, ${q(caption)}, ` +
      `${textArray(likers)}, ${jsonb(comments)}, now() - interval '${i * 3 + 1} days')`
    );
  }).join(",\n") + ";"
);
w();

/* --- forums ------------------------------------------------------------- */

const FORUMS = [
  ["Reunion Planning", "Marc Ellison", [
    ["Nathan Weiss", "Dates are locked for alumni weekend: September 12-14. The dining hall is ours all weekend."],
    ["Rachel Hollander", "Putting my name down for the Saturday sail. Who else is in?"],
    ["Priya Raghunathan", "In. Flying up Friday night, happy to carpool from Portland Jetport if anyone needs a ride."],
    ["Marc Ellison", "We have 40 confirmed so far. This will be the biggest one since 2019."],
  ]],
  ["Cedar Careers & Referrals", "Priya Raghunathan", [
    ["Priya Raghunathan", "Starting this as a place to post openings. Cedar people hire Cedar people."],
    ["Owen Pritchard", "We're hiring two engineers at Flatiron Tools, remote-friendly. DM me and I'll skip you to the front of the queue."],
    ["Marcus Delaney", "Can confirm this works — got my first consulting job through a Cedar counselor in 2019."],
    ["Mira Chandrasekar", "Happy to do mock interviews for anyone going through tech loops. Just message me."],
  ]],
  ["Waterfront & Sailing", "Jordan Whitfield", [
    ["Jordan Whitfield", "Who still sails? Trying to get a Cedar boat entered in the Casco Bay regatta."],
    ["Peter Sandoval", "I'd crew. Haven't raced since 2013 but the muscle memory is there."],
    ["Fiona Gallagher", "Count me in. Also happy to talk lake ecology to anyone who'll listen."],
  ]],
  ["Class of 2010-2015", "Sofia Marchetti", [
    ["Sofia Marchetti", "Our era's thread. Who's still in touch with the 2012 Senior II bunk?"],
    ["Chris Vandenberg", "Half of us are in this network already. The other half need an invite."],
    ["Grace Lindqvist", "Sending this to six people right now."],
  ]],
  ["Cedar Chest Archive", "Claire Beaumont", [
    ["Claire Beaumont", "All ten issues are now digitized and up in the archive. Fall 2019 through Fall 2024."],
    ["Ruth Feingold", "Found my Freshman village write-up from 2005. Incredible."],
  ]],
];

const forumRows = [];
const postRows = [];
let postCounter = 0;

FORUMS.forEach(([name, creatorName, posts], i) => {
  const creator = byName(creatorName);
  const memberIds = people.slice(0, 12 + i * 4).map((p) => p.userId);
  forumRows.push(
    `  (${q(forumId(i + 1))}, ${q(TENANT)}, ${q(name)}, ${q(creator.name)}, ${q(creator.userId)}, ` +
    `${textArray(memberIds)}, ARRAY[${q(creator.userId)}], ${posts.length}, ` +
    `now() - interval '${i + 1} days', now() - interval '${60 - i * 8} days')`
  );
  posts.forEach(([authorName, text], j) => {
    postCounter += 1;
    const author = byName(authorName);
    postRows.push(
      `  (${q(postId(postCounter))}, ${q(TENANT)}, ${q(forumId(i + 1))}, ${q(author.userId)}, ` +
      `'text', ${q(text)}, now() - interval '${(posts.length - j) * 2 + i} days')`
    );
  });
});

w("INSERT INTO public.forums (id, tenant_id, name, created_by, creator_id, member_ids, moderators, posts_count, last_activity_at, created_at) VALUES");
w(forumRows.join(",\n") + ";");
w();
w("INSERT INTO public.forum_posts (id, tenant_id, forum_id, author_id, kind, text, created_at) VALUES");
w(postRows.join(",\n") + ";");
w();

/* --- direct messages ---------------------------------------------------- */

const DM_THREADS = [
  ["Jordan Whitfield", "Priya Raghunathan", [
    ["Jordan Whitfield", "Priya! Saw you're at Harborline now. Congrats on the VP news."],
    ["Priya Raghunathan", "Thank you! Still can't believe it. How's Boston treating you?"],
    ["Jordan Whitfield", "Good — heading up to camp for alumni weekend in September. You going?"],
    ["Priya Raghunathan", "Wouldn't miss it. Booked the flight this morning."],
  ]],
  ["Jordan Whitfield", "Marc Ellison", [
    ["Marc Ellison", "Jordan — would you be up for running the sailing session at alumni weekend?"],
    ["Jordan Whitfield", "Absolutely. Do we still have the same fleet?"],
    ["Marc Ellison", "Two new boats since your time, everything else is the same."],
  ]],
  ["Jordan Whitfield", "Mira Chandrasekar", [
    ["Mira Chandrasekar", "Hey! Someone in the careers forum asked about PM interviews — sent them your way."],
    ["Jordan Whitfield", "Perfect, happy to help. This network is actually working."],
  ]],
];

const convoRows = [];
const msgRows = [];
let msgCounter = 0;

DM_THREADS.forEach(([aName, bName, messages], i) => {
  const a = byName(aName);
  const b = byName(bName);
  const last = messages[messages.length - 1];
  const lastSender = byName(last[0]);
  convoRows.push(
    `  (${q(convoId(i + 1))}, ${q(TENANT)}, 'dm', ARRAY[${q(a.userId)},${q(b.userId)}], '', ` +
    `${q(a.userId)}, now() - interval '${i * 6 + 2} hours', ` +
    `${jsonb({ text: last[1], senderId: lastSender.userId })}, ` +
    `${jsonb([a.userId, b.userId])}, ${jsonb([a.userId])})`
  );
  messages.forEach(([senderName, text], j) => {
    msgCounter += 1;
    const sender = byName(senderName);
    msgRows.push(
      `  (${q(msgId(msgCounter))}, ${q(TENANT)}, ${q(convoId(i + 1))}, ${q(sender.userId)}, ` +
      `${q(text)}, ${q(`demo-seed-${msgCounter}`)}, now() - interval '${(messages.length - j) * 3 + i * 6} hours')`
    );
  });
});

w("INSERT INTO public.conversations (id, tenant_id, type, participant_ids, name, created_by, last_message_at, last_message, members, read_by) VALUES");
w(convoRows.join(",\n") + ";");
w();
w("INSERT INTO public.messages (id, tenant_id, conversation_id, sender_id, text, client_message_id, created_at) VALUES");
w(msgRows.join(",\n") + ";");
w();

/* --- events ------------------------------------------------------------- */

const EVENTS = [
  {
    slug: "alumni-weekend-2026",
    title: "Cedar Alumni Weekend 2026",
    summary: "Three days back on the lake — sailing, the dining hall, campfire, and the Saturday night banquet.",
    body: "<p>Doors open Friday at 4pm. Bunks are first come, first served, and the waterfront is open all weekend.</p><p>Bring your family. Cedar kids under 12 are free.</p>",
    days: 34, hours: 72, place: "Camp Cedar", address: "1 Cedar Lake Road, Casco, ME",
    host: "Marc Ellison", type: "community", capacity: 180, rsvps: 46,
  },
  {
    slug: "cedar-nyc-winter-mixer",
    title: "Cedar NYC Winter Mixer",
    summary: "Drinks and hellos for every Cedar alum in the tri-state area.",
    body: "<p>Casual, no program, just Cedar people in one room. First round is on the alumni fund.</p>",
    days: 12, hours: 3, place: "The Gramercy Room", address: "118 E 20th St, New York, NY",
    host: "Nathan Weiss", type: "community", capacity: 90, rsvps: 31,
  },
  {
    slug: "careers-panel-breaking-into-tech",
    title: "Careers Panel: Breaking Into Tech",
    summary: "Four Cedar alumni on how they got in, what they'd do differently, and who's hiring.",
    body: "<p>Panelists work in engineering, product, design, and data. Bring questions.</p>",
    days: 6, hours: 2, place: "Online", address: "", host: "Mira Chandrasekar",
    type: "seminar", capacity: 200, rsvps: 58, online: true,
  },
  {
    slug: "boston-cedar-summer-sail",
    title: "Boston Cedar Summer Sail",
    summary: "A morning on the harbor with the Cedar sailing crowd, old and new.",
    body: "<p>No experience needed. We will pair first-timers with former waterfront staff.</p>",
    days: 58, hours: 4, place: "Community Boating Inc.", address: "21 David G Mugar Way, Boston, MA",
    host: "Jordan Whitfield", type: "community", capacity: 40, rsvps: 22,
  },
];

const eventRows = [];
const rsvpRows = [];
let rsvpCounter = 0;

EVENTS.forEach((event, i) => {
  const host = byName(event.host);
  eventRows.push(
    `  (${q(eventId(i + 1))}, ${q(TENANT)}, ${q(event.slug)}, 'published', ${q(event.title)}, ` +
    `${q(event.summary)}, ${q(event.body)}, now() + interval '${event.days} days', ` +
    `now() + interval '${event.days} days ${event.hours} hours', 'America/New_York', ` +
    `${q(event.place)}, ${q(event.address)}, now() - interval '${20 - i * 3} days', ` +
    `${q(host.userId)}, ${q(host.userId)}, ${q(event.type)}, ` +
    `${q(event.online ? "online" : "in_person")}, 'all_members', ${q(host.profileId)}, ${event.capacity})`
  );
  people.slice(0, event.rsvps).forEach((p) => {
    rsvpCounter += 1;
    rsvpRows.push(
      `  (${q(`rsvp_demo_${rsvpCounter}`)}, ${q(TENANT)}, ${q(eventId(i + 1))}, ` +
      `${q(p.profileId)}, ${q(p.userId)}, 'attending')`
    );
  });
});

w(`INSERT INTO public.events (
  id, tenant_id, slug, status, title, summary, body_html, starts_at, ends_at, timezone,
  location_name, location_address, published_at, created_by_user_id, updated_by_user_id,
  event_type, delivery_mode, audience, host_profile_id, capacity
) VALUES`);
w(eventRows.join(",\n") + ";");
w();
w("INSERT INTO public.event_rsvps (id, tenant_id, event_id, profile_id, user_id, status) VALUES");
w(rsvpRows.join(",\n") + ";");
w();

/* --- family trees ------------------------------------------------------- */

const TREES = [
  ["The Brennan Family", "Daniel Brennan", [
    ["Daniel Brennan", [["Maeve Brennan", "sibling"], ["Colm Brennan", "sibling"]]],
    ["Maeve Brennan", [["Daniel Brennan", "sibling"], ["Colm Brennan", "sibling"]]],
    ["Colm Brennan", [["Daniel Brennan", "sibling"], ["Maeve Brennan", "sibling"]]],
  ]],
  ["The Hollander Family", "Ben Hollander", [
    ["Ben Hollander", [["Rachel Hollander", "sibling"], ["Ethan Hollander", "child"]]],
    ["Rachel Hollander", [["Ben Hollander", "sibling"], ["Ethan Hollander", "other"]]],
    ["Ethan Hollander", [["Ben Hollander", "parent"]]],
  ]],
  ["The Whitfield Family", "Jordan Whitfield", [
    ["Jordan Whitfield", [["Serena Whitfield", "sibling"]]],
    ["Serena Whitfield", [["Jordan Whitfield", "sibling"]]],
  ]],
  ["The Nakamura Family", "Hana Nakamura", [
    ["Hana Nakamura", [["Kenji Nakamura", "sibling"]]],
    ["Kenji Nakamura", [["Hana Nakamura", "sibling"]]],
  ]],
  ["The Ashford Family", "Oliver Ashford", [
    ["Oliver Ashford", [["Zoe Ashford", "cousin"]]],
    ["Zoe Ashford", [["Oliver Ashford", "cousin"]]],
  ]],
];

w("INSERT INTO public.family_trees (id, tenant_id, name, created_by_user_id, members, created_at) VALUES");
w(
  TREES.map(([name, creatorName, members], i) => {
    const creator = byName(creatorName);
    const payload = members.map(([memberName, rels]) => ({
      profileId: byName(memberName).profileId,
      relationships: rels.map(([toName, type]) => ({
        toProfileId: byName(toName).profileId,
        type,
      })),
    }));
    return (
      `  (${q(`familytree_demo_${i + 1}`)}, ${q(TENANT)}, ${q(name)}, ${q(creator.userId)}, ` +
      `${jsonb(payload)}, now() - interval '${90 - i * 12} days')`
    );
  }).join(",\n") + ";"
);
w();

/* --- newsletters (Cedar Chest archive) ---------------------------------- */

const ISSUES = [
  ["Fall", 2024], ["Spring", 2024], ["Winter", 2024],
  ["Fall", 2023], ["Spring", 2023],
  ["Fall", 2022], ["Spring", 2022], ["Winter", 2022],
  ["Fall", 2020], ["Winter", 2020], ["Fall", 2019],
];

w("INSERT INTO public.newsletters (id, tenant_id, title, season, year, pdf_name, pdf_mime_type, created_at) VALUES");
w(
  ISSUES.map(([season, year], i) =>
    `  (${q(newsletterId(i + 1))}, ${q(TENANT)}, ${q(`${season} ${year} Cedar Chest`)}, ` +
    `${q(season)}, ${year}, ${q(`${year}-${season}-Cedar-Chest.pdf`)}, 'application/pdf', ` +
    `now() - interval '${i * 120 + 30} days')`
  ).join(",\n") + ";"
);
w();

/* --- activity feed ------------------------------------------------------ */

// `announcement.post` renders the message as a bubble; every other type renders
// "<actor> <verb> <target label>", so those rows carry a target instead.
const ACTIVITY = [
  ["Marc Ellison", "announcement.post", "Alumni Weekend 2026 registration is open. September 12-14, back at the lake.", true, null],
  ["Priya Raghunathan", "thread.new", "", false, { href: "/chat-rooms", label: "Cedar Careers & Referrals" }],
  ["Claire Beaumont", "announcement.post", "The full Cedar Chest archive is now searchable — every issue from Fall 2019 forward.", false, null],
  ["Gideon Marsh", "photo.upload", "", false, { href: "/photo-stream", label: "the Photo Stream" }],
  ["Nathan Weiss", "announcement.post", "NYC Winter Mixer is two weeks out and we are at 31 RSVPs.", false, null],
  ["Claire Beaumont", "cedarchest.publish", "", false, { href: "/cedar-chest", label: "the Fall 2024 Cedar Chest" }],
];

w("INSERT INTO public.activity_items (id, tenant_id, actor_user_id, actor, type, message, target, pinned, pinned_at, ts) VALUES");
w(
  ACTIVITY.map(([actorName, type, message, pinned, target], i) => {
    const actor = byName(actorName);
    return (
      `  (${q(`activity_demo_${i + 1}`)}, ${q(TENANT)}, ${q(actor.userId)}, ` +
      `${jsonb({ id: actor.userId, name: actor.name, firstName: actor.first, lastName: actor.last })}, ` +
      `${q(type)}, ${q(message)}, ${jsonb(target || { type: "tenant", id: TENANT })}, ${pinned}, ` +
      `${pinned ? "now()" : "NULL"}, now() - interval '${i * 2 + 1} days')`
    );
  }).join(",\n") + ";"
);
w();

/* --- pre-member alumni contacts (admin import view) --------------------- */

const CONTACTS = [
  ["Wendy", "Kessler", "wendy.kessler@example.test", ["2003", "2004"]],
  ["Arthur", "Nunes", "arthur.nunes@example.test", ["2011"]],
  ["Bree", "Sanderson", "bree.sanderson@example.test", ["2016", "2017"]],
  ["Ollie", "Zhang", "ollie.zhang@example.test", ["2008"]],
  ["Marta", "Kowalczyk", "marta.kowalczyk@example.test", ["2013", "2014", "2015"]],
];

const director = byName("Marc Ellison");
w("INSERT INTO public.alumni_contacts (id, tenant_id, email, first_name, last_name, source, contact_status, tags, camp_years, notes, created_by_user_id) VALUES");
w(
  CONTACTS.map(([first, last, email, years], i) =>
    `  (${q(`alumni_demo_${i + 1}`)}, ${q(TENANT)}, ${q(email)}, ${q(first)}, ${q(last)}, ` +
    `'import', 'active', ${jsonb(["reunion"])}, ${jsonb(years)}, ` +
    `${q("Imported from the 2025 alumni list.")}, ${q(director.userId)})`
  ).join(",\n") + ";"
);
w();

/* --- analytics events (drives the director dashboard charts) ------------ */

// A deterministic pseudo-random source keeps regenerated seeds byte-identical.
let rngState = 20260816;
const rand = () => {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
};

const analyticsRows = [];
let analyticsCounter = 0;

for (let daysAgo = 89; daysAgo >= 0; daysAgo -= 1) {
  // Weekends are quieter, and the network has grown busier over time.
  const weekday = (daysAgo + 3) % 7;
  const weekendFactor = weekday === 0 || weekday === 6 ? 0.45 : 1;
  const growth = 0.5 + (90 - daysAgo) / 90;
  const logins = Math.round((2 + rand() * 5) * weekendFactor * growth);

  for (let k = 0; k < logins; k += 1) {
    const person = people[Math.floor(rand() * people.length)];
    const hour = 7 + Math.floor(rand() * 14);
    analyticsCounter += 1;
    analyticsRows.push(
      `  (${q(`analytics_demo_${analyticsCounter}`)}, ${q(TENANT)}, ${q(person.userId)}, ` +
      `'auth_login_password', ${jsonb({ demo: true })}, ` +
      `now() - interval '${daysAgo} days' + interval '${hour} hours')`
    );

    // Roughly half of sessions include a directory search, which is the
    // behaviour worth showing a director: people actually look each other up.
    if (rand() < 0.5) {
      analyticsCounter += 1;
      analyticsRows.push(
        `  (${q(`analytics_demo_${analyticsCounter}`)}, ${q(TENANT)}, ${q(person.userId)}, ` +
        `'directory_search', ${jsonb({ demo: true })}, ` +
        `now() - interval '${daysAgo} days' + interval '${hour} hours' + interval '4 minutes')`
      );
    }
    if (rand() < 0.2) {
      analyticsCounter += 1;
      analyticsRows.push(
        `  (${q(`analytics_demo_${analyticsCounter}`)}, ${q(TENANT)}, ${q(person.userId)}, ` +
        `'event_detail_viewed', ${jsonb({ demo: true })}, ` +
        `now() - interval '${daysAgo} days' + interval '${hour} hours' + interval '11 minutes')`
      );
    }
  }
}

w(`DELETE FROM public.analytics_events WHERE tenant_id = ${q(TENANT)};`);
w("INSERT INTO public.analytics_events (id, tenant_id, user_id, event_type, metadata, created_at) VALUES");
w(analyticsRows.join(",\n") + ";");
w();

// Give members a plausible last-seen so the People table is not all blanks.
w(`UPDATE public.users u SET last_login_at = sub.last_login
FROM (
  SELECT user_id, MAX(created_at) AS last_login
  FROM public.analytics_events
  WHERE tenant_id = ${q(TENANT)} AND event_type = 'auth_login_password'
  GROUP BY user_id
) AS sub
WHERE u.id = sub.user_id AND u.tenant_id = ${q(TENANT)};`);
w();

w("COMMIT;");
w();

process.stdout.write(out.join("\n") + "\n");

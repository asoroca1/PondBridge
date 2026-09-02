import pptxgen from "pptxgenjs";

const SHOTS = "/private/tmp/claude-501/-Users-asoroca-Desktop-PondBridge-System/c326fa79-be38-4c8d-81c7-25ce8a9c811e/scratchpad/shots";
const OUT = "/private/tmp/claude-501/-Users-asoroca-Desktop-PondBridge-System/c326fa79-be38-4c8d-81c7-25ce8a9c811e/scratchpad/PondBridge-Camp-Cedar.pptx";

// Camp-lake palette: Cedar navy dominates, lantern gold is the single accent.
const NAVY = "0A2E5C";
const NAVY_DEEP = "06203F";
const GOLD = "E8A33D";
const PAPER = "F6F8FB";
const INK = "16202E";
const MUTED = "5A6B80";
const WHITE = "FFFFFF";
const ICE = "C9D9EC";

const HEAD = "Cambria";
const BODY = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.3 x 7.5
pres.author = "PondBridge";
pres.title = "PondBridge — Camp Cedar Alumni Network";

const shadow = () => ({ type: "outer", color: "0A2E5C", opacity: 0.22, blur: 14, offset: 4, angle: 90 });

/* ---------------------------------------------------------------- helpers */

function darkSlide(kicker, title, body) {
  const slide = pres.addSlide();
  slide.background = { color: NAVY_DEEP };
  if (kicker) {
    slide.addText(kicker.toUpperCase(), {
      x: 0.9, y: 2.05, w: 11.5, h: 0.35, margin: 0,
      fontFace: BODY, fontSize: 13, bold: true, color: GOLD, charSpacing: 3,
    });
  }
  slide.addText(title, {
    x: 0.9, y: 2.5, w: 11.5, h: 1.5, margin: 0,
    fontFace: HEAD, fontSize: 44, bold: true, color: WHITE, lineSpacing: 50,
  });
  if (body) {
    slide.addText(body, {
      x: 0.9, y: 4.15, w: 9.6, h: 1.2, margin: 0,
      fontFace: BODY, fontSize: 17, color: ICE, lineSpacing: 26,
    });
  }
  return slide;
}

// Two-column feature slide: the argument on the left, the product on the right.
function shotSlide({ number, title, lead, points, image, notes }) {
  const slide = pres.addSlide();
  slide.background = { color: PAPER };

  if (number) {
    slide.addShape(pres.ShapeType.ellipse, {
      x: 0.62, y: 0.62, w: 0.46, h: 0.46, fill: { color: GOLD },
    });
    slide.addText(String(number), {
      x: 0.62, y: 0.62, w: 0.46, h: 0.46, margin: 0,
      fontFace: BODY, fontSize: 15, bold: true, color: NAVY_DEEP, align: "center", valign: "middle",
    });
  }

  slide.addText(title, {
    x: 0.62, y: 1.25, w: 3.95, h: 1.6, margin: 0,
    fontFace: HEAD, fontSize: 30, bold: true, color: NAVY, lineSpacing: 34,
  });

  slide.addText(lead, {
    x: 0.62, y: 2.95, w: 3.95, h: 1.35, margin: 0,
    fontFace: BODY, fontSize: 14.5, color: INK, lineSpacing: 22,
  });

  if (points?.length) {
    slide.addText(
      points.map((text, i) => ({
        text,
        options: { bullet: { indent: 14 }, breakLine: i !== points.length - 1 },
      })),
      {
        x: 0.62, y: 4.45, w: 3.95, h: 1.8, margin: 0,
        fontFace: BODY, fontSize: 12.5, color: MUTED, paraSpaceAfter: 8, lineSpacing: 17,
      }
    );
  }

  slide.addImage({
    path: `${SHOTS}/${image}`,
    x: 4.9, y: 1.24, w: 7.95, h: 4.97,
    shadow: shadow(),
  });

  if (notes) slide.addNotes(notes);
  return slide;
}

/* ------------------------------------------------------------------ title */

{
  const slide = pres.addSlide();
  slide.background = { color: NAVY_DEEP };
  slide.addText("PONDBRIDGE", {
    x: 0.9, y: 2.15, w: 11.5, h: 0.45, margin: 0,
    fontFace: BODY, fontSize: 15, bold: true, color: GOLD, charSpacing: 6,
  });
  slide.addText("The alumni network\nyour camp already has.", {
    x: 0.9, y: 2.75, w: 11.2, h: 2.1, margin: 0,
    fontFace: HEAD, fontSize: 46, bold: true, color: WHITE, lineSpacing: 54,
  });
  slide.addText(
    "A private, camp-branded platform where your campers, counselors, and staff find each other again — and stay found.",
    {
      x: 0.9, y: 5.0, w: 9.4, h: 1.0, margin: 0,
      fontFace: BODY, fontSize: 17, color: ICE, lineSpacing: 26,
    }
  );
  slide.addText("Live today at Camp Cedar", {
    x: 0.9, y: 6.25, w: 6.0, h: 0.4, margin: 0,
    fontFace: BODY, fontSize: 14, italic: true, color: GOLD,
  });
  slide.addNotes(
    "Open by naming the camp you're writing to. PondBridge is a white-label alumni network — the camp's brand, not ours. Camp Cedar is the live reference customer, and every screen in this deck is their real product with member names and photos swapped out for privacy."
  );
}

/* ---------------------------------------------------------------- problem */

{
  const slide = pres.addSlide();
  slide.background = { color: PAPER };
  slide.addText("Your alumni list is a spreadsheet.\nYour alumni are not.", {
    x: 0.75, y: 0.7, w: 11.8, h: 1.7, margin: 0,
    fontFace: HEAD, fontSize: 36, bold: true, color: NAVY, lineSpacing: 44,
  });

  const cards = [
    ["Contact data rots", "Every year a share of your list goes stale. People move, change jobs, change emails — and nobody tells the camp."],
    ["Reach is one-directional", "A newsletter blast goes out. Nothing comes back. You cannot see who opened it, who reconnected, or who would have given."],
    ["The community lives elsewhere", "Your alumni already talk to each other — in group texts and scattered Facebook groups you do not run and cannot see."],
  ];

  cards.forEach(([heading, text], i) => {
    const x = 0.75 + i * 4.05;
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: 2.75, w: 3.7, h: 3.2,
      fill: { color: WHITE }, rectRadius: 0.1, shadow: shadow(),
    });
    slide.addShape(pres.ShapeType.ellipse, {
      x: x + 0.35, y: 3.08, w: 0.44, h: 0.44, fill: { color: GOLD },
    });
    slide.addText(String(i + 1), {
      x: x + 0.35, y: 3.08, w: 0.44, h: 0.44, margin: 0,
      fontFace: BODY, fontSize: 14, bold: true, color: NAVY_DEEP,
      align: "center", valign: "middle",
    });
    slide.addText(heading, {
      x: x + 0.35, y: 3.68, w: 3.0, h: 0.62, margin: 0,
      fontFace: HEAD, fontSize: 18, bold: true, color: NAVY, lineSpacing: 22,
    });
    slide.addText(text, {
      x: x + 0.35, y: 4.38, w: 3.0, h: 1.4, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: MUTED, lineSpacing: 18,
    });
  });

  slide.addNotes(
    "Three failure modes every camp director recognises. Don't oversell — let them nod. The point is that the camp already owns the relationship; it just has no place to live."
  );
}

/* -------------------------------------------------------------- what it is */

{
  const slide = pres.addSlide();
  slide.background = { color: PAPER };
  slide.addText("One private network, under your camp's name", {
    x: 0.75, y: 0.7, w: 11.8, h: 0.9, margin: 0,
    fontFace: HEAD, fontSize: 34, bold: true, color: NAVY,
  });
  slide.addText(
    "Members sign in to your camp's site — your logo, your colours, your photography. PondBridge runs everything behind it.",
    {
      x: 0.75, y: 1.7, w: 9.8, h: 0.7, margin: 0,
      fontFace: BODY, fontSize: 15.5, color: INK, lineSpacing: 22,
    }
  );

  const rows = [
    ["For your alumni", "A searchable directory, a map of where everyone landed, messaging, forums, photos, family trees, and every newsletter you have ever published."],
    ["For you", "A director's console: who joined, who is active, who to email, and what to run next — without exporting a thing."],
    ["For the camp", "The list stays yours. It updates itself, because members keep their own profiles current."],
  ];

  rows.forEach(([heading, text], i) => {
    const y = 2.7 + i * 1.45;
    slide.addShape(pres.ShapeType.ellipse, {
      x: 0.78, y: y + 0.05, w: 0.5, h: 0.5, fill: { color: NAVY },
    });
    slide.addText(String(i + 1), {
      x: 0.78, y: y + 0.05, w: 0.5, h: 0.5, margin: 0,
      fontFace: BODY, fontSize: 15, bold: true, color: GOLD, align: "center", valign: "middle",
    });
    slide.addText(heading, {
      x: 1.6, y, w: 3.0, h: 0.45, margin: 0,
      fontFace: HEAD, fontSize: 19, bold: true, color: NAVY,
    });
    slide.addText(text, {
      x: 1.6, y: y + 0.48, w: 10.6, h: 0.85, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: MUTED, lineSpacing: 19,
    });
  });

  slide.addNotes(
    "The key line is 'under your camp's name'. Directors are wary of handing their alumni to a third-party social network. This is the opposite: it is their site, their data, their brand."
  );
}

/* ------------------------------------------------------------- case study */

darkSlide(
  "Live case study",
  "Camp Cedar Alumni Network",
  "Every screen that follows is Camp Cedar's live product. Member names, employers, and photos have been replaced with fictional stand-ins, and profile pictures removed, so nothing here identifies a real alum."
).addNotes(
  "Say this part plainly — it builds trust rather than costing you anything. The branding, photography, and newsletter archive are genuinely Cedar's. The people are invented."
);

/* -------------------------------------------------------- member journey */

shotSlide({
  number: 1,
  title: "It looks like your camp, not like software",
  lead: "Members arrive at a site carrying your crest, your lake, and your name. No third-party branding anywhere in the experience.",
  points: ["Your logo, palette, and photography", "Your own domain", "Works on phones and desktop"],
  image: "01-landing.png",
  notes: "Lead with brand ownership. Directors care that this feels like an extension of camp, not a vendor's product.",
});

shotSlide({
  number: 2,
  title: "A home page that shows the camp is still alive",
  lead: "Announcements, recent photos, upcoming events, and people worth meeting — the first thing an alum sees is activity, not an empty form.",
  points: ["Director announcements pinned to the top", "Live member and location counts", "Suggested profiles based on shared history"],
  image: "02-home.png",
  notes: "The community pulse counters in the top right are the quiet sell: proof to the member that other people are here too.",
});

shotSlide({
  number: 3,
  title: "Find anyone, by anything",
  lead: "Filter the directory by camp role, camper years, industry, employer, college, graduation year, or city — the questions alumni actually ask.",
  points: ["Nine filter groups, combinable", "Message any member from the result card", "Directory stays private to your camp"],
  image: "03-advanced-search.png",
  notes: "This is the feature alumni ask for first and the one that keeps them coming back. Mention that a member can go from 'who works in tech' to a direct message in two clicks.",
});

shotSlide({
  number: 4,
  title: "See where your camp ended up",
  lead: "Every member's city on one map. Click a pin to see who lives there — the fastest way to plan a regional event or find a host.",
  points: ["Clustered by city and region", "Click through to profiles and messaging", "Updates itself as members move"],
  image: "05-alumni-map.png",
  notes: "Directors immediately think about regional reunions. Point at a cluster and ask where their alumni actually are — they usually don't know.",
});

shotSlide({
  number: 5,
  title: "The photos come back out of the drawer",
  lead: "A shared stream where alumni post the pictures they have been sitting on for twenty years, and everyone else recognises the dock.",
  points: ["Members upload, like, and comment", "Sorted by newest or most loved", "Moderation controls for the director"],
  image: "06-photo-stream.png",
  notes: "Nostalgia is the engagement engine. This is usually the screen that makes a director smile — let it sit for a beat.",
});

shotSlide({
  number: 6,
  title: "Where alumni actually help each other",
  lead: "Forums by topic and era, plus direct messaging. Career threads are consistently the most active — the camp becomes a professional network too.",
  points: ["Topic and era-based forums", "Direct and group messaging", "Report and moderation tools built in"],
  image: "07b-forums.png",
  notes: "The referral thread is the strongest single argument in the deck: alumni hiring alumni is a benefit the camp gets credit for, at no cost to the camp.",
});

shotSlide({
  number: 7,
  title: "Your newsletter, finally archived",
  lead: "Every issue you have ever published, in one browsable archive that members can filter by season and year — instead of a folder of PDFs nobody can find.",
  points: ["Full back catalogue in one place", "Filter by season and year", "Upload new issues in a click"],
  image: "08-cedar-chest.png",
  notes: "Cedar's own newsletter is called the Cedar Chest, and the archive keeps that name — another example of the platform taking on the camp's language, not ours.",
});

shotSlide({
  number: 8,
  title: "Camp families, mapped",
  lead: "Multi-generation camp families are the backbone of enrolment. Family trees make those lines visible — and remind everyone how deep the roots go.",
  points: ["Siblings, parents, cousins, and partners", "Built by members themselves", "Links straight through to profiles"],
  image: "10-family-tree-view.png",
  notes: "Tie this to enrolment: second- and third-generation families are a camp's most reliable pipeline, and this makes them legible.",
});

shotSlide({
  number: 9,
  title: "Events that fill themselves",
  lead: "Reunions, city mixers, and alumni-led info sessions — published once, with RSVPs tracked and the whole network notified.",
  points: ["In-person and online sessions", "Live RSVP counts and capacity", "Alumni can host, not just attend"],
  image: "12-events.png",
  notes: "Point out that alumni-led career sessions cost the camp nothing to run and drive more sign-ins than anything else.",
});

shotSlide({
  number: 10,
  title: "Profiles that stay current on their own",
  lead: "Members maintain their own history, jobs, and contact details. Your list stops decaying the day they sign up.",
  points: ["Camp history, career, and education", "Member-controlled privacy settings", "Related profiles surface old bunkmates"],
  image: "11-public-profile.png",
  notes: "This answers the 'how do we keep the data fresh' objection: you don't, they do. That's the structural advantage over a spreadsheet.",
});

/* ------------------------------------------------------------- director */

darkSlide(
  "The other half",
  "What you see as director",
  "Everything above is the member's view. Behind it is a console built for the person who actually has to run the thing — usually alongside a full-time job running a camp."
).addNotes(
  "Transition deliberately. Most directors' real fear is the admin burden, so spend real time on the next four slides."
);

shotSlide({
  number: 11,
  title: "One screen that tells you what needs you",
  lead: "Membership, sign-ins, new joins, and profile completeness at a glance — plus a plain-language list of anything waiting on your decision.",
  points: ["Growth and engagement over time", "Access requests and issues surfaced first", "Built-in AI assistant for drafting and questions"],
  image: "14-admin-dashboard.png",
  notes: "'Nothing needs you' is the line to land on. The console is designed so that a quiet week takes thirty seconds to check.",
});

shotSlide({
  number: 12,
  title: "Every person, at every stage",
  lead: "Prospects, invited, requested, and active members in one list — with join dates, last activity, and profile completeness on every row.",
  points: ["Import your existing alumni list", "Filter by role, year, or completeness", "Export any segment at any time"],
  image: "15-admin-people.png",
  notes: "Stress the import and the export. Directors need to hear that they can get their data out as easily as they put it in — it defuses the lock-in worry.",
});

shotSlide({
  number: 13,
  title: "Email your alumni without leaving the platform",
  lead: "Compose to a segment you just filtered, send from your camp's address, and see what happened — no separate mail tool, no re-uploading lists.",
  points: ["Send to any filtered segment", "Delivery and bounce tracking", "Full history of what you have sent"],
  image: "17-admin-email.png",
  notes: "This usually replaces a Mailchimp bill and, more importantly, the manual CSV export that made every send a chore.",
});

shotSlide({
  number: 14,
  title: "You control the branding and the features",
  lead: "Your logo, colours, and welcome copy are yours to change. Every module — map, photos, forums, family trees, newsletter — can be switched on when you are ready.",
  points: ["Brand controls with live preview", "Turn modules on and off per camp", "Start small and grow into it"],
  image: "18-admin-branding.png",
  notes: "The reassurance slide. A camp that only wants a directory and a newsletter can launch with just those two and add the rest later.",
});

/* ------------------------------------------------------------------- why */

{
  const slide = pres.addSlide();
  slide.background = { color: PAPER };
  slide.addText("Why camps choose this over the alternatives", {
    x: 0.75, y: 0.7, w: 11.8, h: 0.9, margin: 0,
    fontFace: HEAD, fontSize: 32, bold: true, color: NAVY,
  });

  const compare = [
    ["A Facebook group", "You do not own it, cannot search it properly, cannot email from it, and a growing share of your younger alumni are not on it."],
    ["A spreadsheet and a mail tool", "Accurate the day you build it, stale within a year, and it never gives anything back to the alumni themselves."],
    ["A university-style alumni platform", "Priced and built for institutions with development offices. Camps get the invoice without the staff to use it."],
    ["PondBridge", "Built for camps specifically. Your brand, your data, member-maintained, and one person can run it."],
  ];

  compare.forEach(([heading, text], i) => {
    const y = 1.85 + i * 1.24;
    const isUs = i === compare.length - 1;
    slide.addShape(pres.ShapeType.roundRect, {
      x: 0.75, y, w: 11.8, h: 1.08,
      fill: { color: isUs ? NAVY : WHITE }, rectRadius: 0.08,
      shadow: shadow(),
    });
    slide.addText(heading, {
      x: 1.05, y: y + 0.14, w: 3.3, h: 0.8, margin: 0,
      fontFace: HEAD, fontSize: 16, bold: true,
      color: isUs ? GOLD : NAVY, valign: "middle",
    });
    slide.addText(text, {
      x: 4.5, y: y + 0.14, w: 7.75, h: 0.8, margin: 0,
      fontFace: BODY, fontSize: 12.5,
      color: isUs ? ICE : MUTED, lineSpacing: 17, valign: "middle",
    });
  });

  slide.addNotes(
    "Only use this slide if the director raises alternatives. If they haven't, skipping it keeps the meeting shorter and warmer."
  );
}

/* -------------------------------------------------------------------- CTA */

{
  const slide = pres.addSlide();
  slide.background = { color: NAVY_DEEP };
  slide.addText("WHAT HAPPENS NEXT", {
    x: 0.9, y: 1.15, w: 11.5, h: 0.4, margin: 0,
    fontFace: BODY, fontSize: 13, bold: true, color: GOLD, charSpacing: 4,
  });
  slide.addText("Let's put your camp on it", {
    x: 0.9, y: 1.65, w: 11.5, h: 1.0, margin: 0,
    fontFace: HEAD, fontSize: 40, bold: true, color: WHITE,
  });

  const steps = [
    ["A 20-minute call", "You show me what you have — a list, a newsletter, a Facebook group — and I tell you honestly whether this fits."],
    ["A branded preview", "I build your camp's network with your logo and colours so you can see it before committing to anything."],
    ["Import and launch", "We load your alumni list, invite the first group, and you go live. Most camps launch within a few weeks."],
  ];

  steps.forEach(([heading, text], i) => {
    const x = 0.9 + i * 3.95;
    slide.addShape(pres.ShapeType.ellipse, {
      x, y: 3.1, w: 0.55, h: 0.55, fill: { color: GOLD },
    });
    slide.addText(String(i + 1), {
      x, y: 3.1, w: 0.55, h: 0.55, margin: 0,
      fontFace: BODY, fontSize: 17, bold: true, color: NAVY_DEEP, align: "center", valign: "middle",
    });
    slide.addText(heading, {
      x, y: 3.9, w: 3.5, h: 0.5, margin: 0,
      fontFace: HEAD, fontSize: 19, bold: true, color: WHITE,
    });
    slide.addText(text, {
      x, y: 4.45, w: 3.5, h: 1.5, margin: 0,
      fontFace: BODY, fontSize: 13, color: ICE, lineSpacing: 19,
    });
  });

  slide.addText("Aden Soroca  ·  PondBridge", {
    x: 0.9, y: 6.35, w: 8.0, h: 0.4, margin: 0,
    fontFace: BODY, fontSize: 15, bold: true, color: GOLD,
  });

  slide.addNotes(
    "Close on the branded preview — it is the lowest-commitment step and the one that converts. Replace the contact line with your email and phone before sending."
  );
}

await pres.writeFile({ fileName: OUT });
console.log("wrote", OUT);

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, PageShell } from "@pondbridge/ui";
import AgentWorkspace from "../components/agent/AgentWorkspace.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useTenant } from "../context/TenantContext.jsx";
import { resolveCampAiName, resolveMediaStreamLabel, resolveNewsletterLabel } from "../lib/campLabels.js";
import { requestJson } from "../lib/http.js";
import { tenantRoute } from "../lib/tenantRouting.js";
import "./member-camp-ai.css";

const MEMBER_STARTERS = [
  "Who should I reconnect with?",
  "Find former counselors in Boston",
  "Who joined recently?",
  "Show me upcoming seminars"
];

function messageId(prefix = "message") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizedQuestion(value = "") {
  return String(value || "").trim().toLowerCase();
}

function memberName(item = {}) {
  const fullName = `${item.firstName || ""} ${item.lastName || ""}`.trim();
  return fullName || String(item.name || item.nickname || "View member").trim();
}

function memberProfileId(item = {}) {
  return String(item.id || item._id || item.profileId || item.userId || "").trim();
}

function memberAvatarUrl(item = {}) {
  return String(item.photoUrl || item.avatarUrl || item?.uploads?.photoUrl || "").trim();
}

function memberInitials(item = {}) {
  return memberName(item)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

function recommendationDescription(item = {}) {
  const kind = String(item?.recommendation?.kind || "").trim();
  const label = String(item?.recommendation?.label || "").trim().toLowerCase();
  if (kind === "recent_member") return "Recently joined the community";
  if (kind === "shared_profile" && label.includes("strong")) {
    return "You have several things in common";
  }
  if (kind === "shared_profile") return "You have a few things in common";
  return "Camp community member";
}

function searchResultDescription(item = {}) {
  const currentCompany = String(item?.currentJobs?.[0]?.company || "").trim();
  const details = [
    String(item.roleAtCamp || "").trim(),
    String(item.cityState || "").trim(),
    currentCompany || String(item.industry || "").trim()
  ].filter(Boolean);
  return details.slice(0, 2).join(" · ") || "Camp community member";
}

function memberResultLink({ item, slug, description }) {
  const id = memberProfileId(item);
  if (!id) return null;
  return {
    presentation: "profile",
    label: memberName(item),
    description,
    initials: memberInitials(item),
    imageUrl: memberAvatarUrl(item),
    href: tenantRoute(slug, `/profile/${id}`)
  };
}

export function memberDiscoveryIntent(question = "") {
  const normalized = normalizedQuestion(question);
  if (
    /\b(new|newest|recent|recently)\b.*\b(member|members|join|joined|community)\b/.test(normalized) ||
    /\b(who|people|members)\b.*\b(joined|newest)\b/.test(normalized)
  ) {
    return "recent";
  }
  if (
    /\b(reconnect|recommend|recommendation|suggest|suggestion|introduce|introduction|meet)\b/.test(normalized) ||
    /\bwho should i\b.*\b(contact|know|talk|message)\b/.test(normalized)
  ) {
    return "personalized";
  }
  return "";
}

export function buildSuggestionAnswer({ data, slug }) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const mode = data?.mode === "recent" ? "recent" : "personalized";
  const hasSharedProfileMatch = items.some(
    (item) => item?.recommendation?.kind === "shared_profile"
  );
  const links = items
    .map((item) =>
      memberResultLink({
        item,
        slug,
        description: recommendationDescription(item)
      })
    )
    .filter(Boolean)
    .slice(0, 6);

  if (!links.length) {
    return {
      content: mode === "recent"
        ? "There are no recent active members to show yet."
        : "I don’t have enough active profile information to make a useful recommendation yet. Advanced Search can still help you find people by camp role, year, work, school, or location.",
      links: [{ label: "Open advanced search", href: tenantRoute(slug, "/search") }],
      disclaimer: "No message was sent and no profile was changed."
    };
  }

  return {
    content: mode === "recent"
      ? "These members recently joined the community."
      : hasSharedProfileMatch
        ? "Here are a few people you may want to reconnect with."
        : "I couldn’t find close profile matches yet, but these newer members could be good people to welcome.",
    links,
    disclaimer: "Private to this camp · Blocked connections excluded · Nothing was sent"
  };
}

export function buildMemberGuideAnswer({ question, slug, tenant }) {
  const normalized = normalizedQuestion(question);
  const modules = tenant?.config?.modules || tenant?.modules || {};
  const newsletterLabel = resolveNewsletterLabel(tenant);
  const mediaStreamLabel = resolveMediaStreamLabel(tenant);

  if (/\b(message|messages|chat|forum|contact|reach out)\b/.test(normalized)) {
    return modules.chat === false
      ? {
          content: "Messaging is not currently available in this camp community.",
          links: []
        }
      : {
          content: "Open Messages to continue an existing conversation, start a direct message, or join a camp forum.",
          links: [{ label: "Open Messages", href: tenantRoute(slug, "/chat-rooms?tab=personal") }]
        };
  }

  if (/\b(event|events|calendar|reunion|rsvp|seminar|seminars|info sessions?|information sessions?|zoom|teams)\b/.test(normalized)) {
    return modules.events === false
      ? {
          content: "Events and seminars are not currently enabled for this camp community.",
          links: []
        }
      : {
          content: "You can browse upcoming camp events and registered-member info sessions, review the host and topic, RSVP, and securely open an online room from the Events & Info Sessions page.",
          links: [{ label: "View events & seminars", href: tenantRoute(slug, "/events") }]
        };
  }

  if (/\b(photo|photos|picture|pictures|album)\b/.test(normalized)) {
    return modules.photoStream === false
      ? {
          content: `${mediaStreamLabel} is not currently enabled for this camp community.`,
          links: []
        }
      : {
          content: `${mediaStreamLabel} is where members share and revisit camp photos and videos.`,
          links: [{ label: `Open ${mediaStreamLabel}`, href: tenantRoute(slug, "/photo-stream") }]
        };
  }

  if (/\b(map|near me|nearby|location|where people live)\b/.test(normalized)) {
    return modules.map === false
      ? {
          content: "The member map is not currently enabled for this camp community.",
          links: []
        }
      : {
          content: "Use the camp map to explore where community members live and reconnect by location.",
          links: [{ label: "Open member map", href: tenantRoute(slug, "/location-map") }]
        };
  }

  if (/\b(family tree|family trees|camp family|lineage)\b/.test(normalized)) {
    return modules.familyTrees === false
      ? {
          content: "Family Trees are not currently enabled for this camp community.",
          links: []
        }
      : {
          content: "Camp Family Trees lets you explore or add the relationships that connect generations.",
          links: [{ label: "Open Family Trees", href: tenantRoute(slug, "/family-trees") }]
        };
  }

  if (/\b(newsletter|news letter|cedar chest|updates archive)\b/.test(normalized)) {
    return modules.newsletter === false
      ? {
          content: `${newsletterLabel} is not currently enabled for this camp community.`,
          links: []
        }
      : {
          content: `You can read past community updates in ${newsletterLabel}.`,
          links: [{ label: `Open ${newsletterLabel}`, href: tenantRoute(slug, "/newsletter") }]
        };
  }

  if (/\b(edit|update|change).*\b(profile|photo|name|job|location)\b|\bmy profile\b/.test(normalized)) {
    return {
      content: "You can update your profile details, camp history, work, education, photo, and privacy choices from Edit Profile.",
      links: [{ label: "Edit my profile", href: tenantRoute(slug, "/edit-profile") }]
    };
  }

  return null;
}

function buildSearchAnswer({ data, slug }) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Number.isFinite(data?.total) ? data.total : items.length;
  const links = items
    .map((item) =>
      memberResultLink({
        item,
        slug,
        description: searchResultDescription(item)
      })
    )
    .filter(Boolean)
    .slice(0, 6);

  if (!total) {
    return {
      content: "I couldn’t find a member matching that description. Try a broader role, location, company, industry, school, or camp-year range.",
      links: [{ label: "Open advanced search", href: tenantRoute(slug, "/search") }]
    };
  }

  return {
    content: `I found ${total} matching member${total === 1 ? "" : "s"}. Here ${total === 1 ? "is the match" : "are the closest results"}:`,
    links: [
      ...links,
      ...(total > links.length ? [{ label: `Explore all ${total} matches`, href: tenantRoute(slug, "/search") }] : [])
    ],
    disclaimer:
      data?.mode === "ai"
        ? "AI interpreted your request · Results stayed private to this camp"
        : "Private camp search · Nothing was sent"
  };
}

export default function MemberCampAiPage() {
  const { token, getAuthToken } = useAuth();
  const { tenant, slug } = useTenant();
  const responseRef = useRef(null);
  const [capability, setCapability] = useState(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const aiName = resolveCampAiName(tenant);

  useEffect(() => {
    let active = true;
    requestJson(`/api/t/${slug}/search/ai/capabilities`, {
      token,
      getToken: async ({ forceRefresh = false } = {}) =>
        (await getAuthToken?.({ forceRefresh })) || token
    })
      .then((payload) => {
        if (active) setCapability(payload || null);
      })
      .catch(() => {
        if (active) setCapability({ featureEnabled: false, available: false });
      });
    return () => {
      active = false;
    };
  }, [getAuthToken, slug, token]);

  const submitQuestion = useCallback(async (questionInput) => {
    const nextQuestion = String(questionInput || "").trim();
    if (!nextQuestion || asking) return;

    setQuestion("");
    setError("");
    setMessages((current) => [
      ...current,
      { id: messageId("user"), role: "user", content: nextQuestion }
    ]);
    setAsking(true);

    try {
      const discoveryMode = memberDiscoveryIntent(nextQuestion);
      let result = null;

      if (discoveryMode) {
        try {
          const data = await requestJson(
            `/api/t/${slug}/suggestions?limit=6&mode=${encodeURIComponent(discoveryMode)}`,
            {
              token,
              getToken: async ({ forceRefresh = false } = {}) =>
                (await getAuthToken?.({ forceRefresh })) || token
            }
          );
          result = buildSuggestionAnswer({ data, slug });
        } catch {
          result = {
            content:
              "Personalized reconnection suggestions are temporarily unavailable. You can still search your camp directory by role, year, work, school, or location.",
            links: [{ label: "Open advanced search", href: tenantRoute(slug, "/search") }],
            disclaimer: "No message was sent and no profile was changed."
          };
        }
      }

      if (!result) {
        result = buildMemberGuideAnswer({ question: nextQuestion, slug, tenant });
      }

      if (!result && capability?.featureEnabled) {
        const data = await requestJson(`/api/t/${slug}/search/ai/query`, {
          method: "POST",
          token,
          getToken: async ({ forceRefresh = false } = {}) =>
            (await getAuthToken?.({ forceRefresh })) || token,
          body: { query: nextQuestion, limit: 12, sort: "name" }
        });
        result = buildSearchAnswer({ data, slug });
      }

      if (!result) {
        result = {
          content:
            "I can help you find people in this camp community and point you to messages, events, photos, the member map, family trees, newsletters, or profile settings. Smart member matching is not enabled for this camp yet.",
          links: [{ label: "Open advanced search", href: tenantRoute(slug, "/search") }]
        };
      }

      setMessages((current) => [
        ...current,
        {
          id: messageId("assistant"),
          role: "assistant",
          author: aiName,
          ...result
        }
      ]);
      window.requestAnimationFrame(() => responseRef.current?.focus({ preventScroll: true }));
    } catch (requestError) {
      setError(requestError.message || `${aiName} could not complete that request. Please try again.`);
    } finally {
      setAsking(false);
    }
  }, [aiName, asking, capability?.featureEnabled, getAuthToken, slug, tenant, token]);

  function ask(event) {
    event.preventDefault();
    return submitQuestion(question);
  }

  return (
    <PageShell className="pb-cedar-page member-camp-ai-page">
      <AgentWorkspace
        variant="chat"
        eyebrow="Your camp community assistant"
        title={aiName}
        subtitle="Find people and get to the right place in your community."
        status={
          capability ? (
            <Badge tone={capability.available ? "success" : "neutral"}>
              {capability.available ? "AI search on" : capability.featureEnabled ? "Private guided mode" : "Camp guide"}
            </Badge>
          ) : null
        }
        boundary={
          <>
            <strong>Your camp stays private.</strong> For member searches, AI receives only your search sentence and generic camp role labels—never profiles, results, email addresses, or phone numbers. Answers cannot send messages or change anything.
          </>
        }
        boundaryLabel="Private by design"
        messages={messages}
        responseRef={responseRef}
        busy={asking}
        assistantName={aiName}
        thinkingLabel={`${aiName} is searching your camp…`}
        emptyState={{
          title: `How can ${aiName} help?`,
          description: "Describe someone you want to reconnect with or ask where to find something in your camp community."
        }}
        composer={{
          id: "member-camp-ai-question",
          question,
          onQuestionChange: setQuestion,
          onSubmit: ask,
          onStarterSelect: submitQuestion,
          starters: messages.length ? [] : MEMBER_STARTERS,
          label: `Message ${aiName}`,
          placeholder: "Ask about people, events, messages, photos, or your profile…",
          privacyNote: "Do not enter passwords, access codes, payment details, or emergency information.",
          submitLabel: `Send to ${aiName}`
        }}
      >
        {error ? <p className="agent-page-feedback error-text" role="alert">{error}</p> : null}
      </AgentWorkspace>
    </PageShell>
  );
}

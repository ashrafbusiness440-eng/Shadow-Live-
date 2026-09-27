import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const libRoot = path.join(root, "lib");

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".dart")) out.push(full);
  }
  return out;
}

function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}

function classify(relative, text, snapshots) {
  const lowerPath = relative.toLowerCase();
  const lower = text.toLowerCase();
  const categories = new Set();

  if (snapshots <= 0) return [];

  if (
    lowerPath.includes("/room/") ||
    lowerPath.includes("/voice/") ||
    lower.includes("collection('rooms')") ||
    lower.includes('collection("rooms")')
  ) categories.add("room");

  if (
    lower.includes("conversations") ||
    lowerPath.includes("message") ||
    lowerPath.includes("chat")
  ) categories.add("conversations");

  if (
    lower.includes("collection('users')") ||
    lower.includes('collection("users")') ||
    lower.includes("users/")
  ) categories.add("current_user");

  if (lowerPath.includes("rocket") || lower.includes("room_rocket")) {
    categories.add("rocket");
  }

  if (lowerPath.includes("/profile/") || lowerPath.includes("profile_")) {
    categories.add("profile");
  }

  if (lowerPath.includes("/wallet/") || lowerPath.includes("wallet_")) {
    categories.add("wallet");
  }

  if (categories.size === 0) categories.add("other");
  return [...categories];
}

const files = [];
const totals = {
  all: 0,
  room: 0,
  conversations: 0,
  current_user: 0,
  rocket: 0,
  profile: 0,
  wallet: 0,
  other: 0,
};

for (const file of walk(libRoot)) {
  const text = fs.readFileSync(file, "utf8");
  const snapshots = countMatches(text, /\.snapshots\s*\(/g);
  if (snapshots <= 0) continue;
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const categories = classify(relative, text, snapshots);
  totals.all += snapshots;
  for (const category of categories) totals[category] += snapshots;
  files.push({ file: relative, snapshots, categories });
}

files.sort((a, b) => b.snapshots - a.snapshots || a.file.localeCompare(b.file));

const repeatedCurrentUser = files.filter(
  (item) => item.categories.includes("current_user"),
);
const repeatedConversations = files.filter(
  (item) => item.categories.includes("conversations"),
);

const report = {
  generatedAt: new Date().toISOString(),
  totals,
  files,
  repeatedCurrentUserFiles: repeatedCurrentUser.map((item) => item.file),
  repeatedConversationFiles: repeatedConversations.map((item) => item.file),
  duplicateSignals: {
    currentUserListenerFiles: repeatedCurrentUser.length,
    conversationListenerFiles: repeatedConversations.length,
    currentUserDuplicationLikely: repeatedCurrentUser.length > 1,
    conversationDuplicationLikely: repeatedConversations.length > 1,
  },
};

fs.writeFileSync(
  "listener-budget.json",
  JSON.stringify(report, null, 2) + "\n",
);

const rows = files
  .map(
    (item) =>
      `| ${item.file} | ${item.snapshots} | ${item.categories.join(", ")} |`,
  )
  .join("\n");

const markdown = [
  "# Shadow Live Listener Budget",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  `Total .snapshots() call sites: **${totals.all}**`,
  `Room: **${totals.room}**`,
  `Conversations: **${totals.conversations}**`,
  `users/{uid}: **${totals.current_user}**`,
  `Rocket: **${totals.rocket}**`,
  `Profile: **${totals.profile}**`,
  `Wallet: **${totals.wallet}**`,
  "",
  "## Listener call sites",
  "",
  "| File | snapshots() | Categories |",
  "| --- | ---: | --- |",
  rows || "| — | 0 | — |",
  "",
].join("\n");

fs.writeFileSync("listener-budget.md", markdown);

console.log(
  JSON.stringify(
    {
      ok: true,
      totals,
      currentUserListenerFiles: repeatedCurrentUser.length,
      conversationListenerFiles: repeatedConversations.length,
    },
    null,
    2,
  ),
);

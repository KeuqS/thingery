// Account page (login/signup, API key display) — loaded from /login.html.
let mode = "signup";
const $ = (id) => document.getElementById(id);

async function checkSession() {
  const res = await fetch("/api/me");
  const data = await res.json();
  if (data.seller) showDone(data.seller);
}

function showDone(seller) {
  $("auth").hidden = true;
  $("done").hidden = false;
  $("welcome").textContent = `Logged in as ${seller.name}`;
  $("apikey").textContent = seller.api_key;

  const mcpUrl = `${location.origin}/mcp`;
  $("mcp-url").textContent = mcpUrl;
  $("mcp-config").textContent = JSON.stringify(
    { mcpServers: { thingery: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${seller.api_key}` } } } },
    null,
    2,
  );
  $("copy-config").onclick = () => {
    navigator.clipboard.writeText($("mcp-config").textContent);
    $("copy-config").textContent = "Copied ✓";
  };
  $("copy-url").onclick = () => {
    navigator.clipboard.writeText(mcpUrl);
    $("copy-url").textContent = "Copied ✓";
  };
}

$("mode").onclick = (e) => {
  e.preventDefault();
  mode = mode === "signup" ? "login" : "signup";
  $("form-title").textContent = mode === "signup" ? "Create your account" : "Log in";
  $("submit").textContent = mode === "signup" ? "Sign up" : "Log in";
  $("mode").textContent = mode === "signup"
    ? "I already have an account — log in"
    : "I need to create an account";
  $("name").parentElement.style.display = mode === "signup" ? "" : "none";
  $("error").textContent = "";
};

$("form").onsubmit = async (e) => {
  e.preventDefault();
  $("error").textContent = "";
  const body = { email: $("email").value.trim(), password: $("password").value };
  if (mode === "signup" && $("name").value.trim()) body.name = $("name").value.trim();
  const res = await fetch(`/api/${mode}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) { $("error").textContent = data.error || "Something went wrong."; return; }
  showDone(data.seller);
};

$("logout").onclick = async (e) => {
  e.preventDefault();
  await fetch("/api/logout", { method: "POST" });
  location.reload();
};

checkSession();

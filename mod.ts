// mod.ts
import { serve } from "https://deno.land/std@0.181.0/http/server.ts";
import { Client as NotionClient } from "npm:@notionhq/client";

// Initialize Notion client
const notion = new NotionClient({ auth: Deno.env.get("NOTION_API_KEY")! });

// Environment variables
const NOTION_SIGNING_SECRET = Deno.env.get("NOTION_WEBHOOK_SIGNING_SECRET")!;
const DRIVE_SA_EMAIL = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL")!;
const DRIVE_SA_KEY = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")!;
const DRIVE_ROOT_FOLDER = Deno.env.get("DRIVE_ROOT_FOLDER") ?? "root";

// Verify Notion webhook signature (HMAC-SHA256)
async function verifySignature(rawBody: string, signature: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(NOTION_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hashArray = Array.from(new Uint8Array(sigBuffer));
  const expected = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  if (signature !== expected) {
    throw new Error("Invalid signature");
  }
}

// Obtain Google Drive OAuth2 token via JWT using service account
async function getDriveAccessToken(): Promise<string> {
  const jwtHeader = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const jwtClaim = {
    iss: DRIVE_SA_EMAIL,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  function base64UrlEncode(obj: object): string {
    return btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  const unsigned = `${base64UrlEncode(jwtHeader)}.${base64UrlEncode(jwtClaim)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    new TextEncoder().encode(DRIVE_SA_KEY.replace(/\\n/g, "\n")),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await resp.json();
  return data.access_token;
}

// Google Drive operations
async function createFolder(name: string): Promise<string> {
  const token = await getDriveAccessToken();
  const resp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [DRIVE_ROOT_FOLDER] }),
  });
  const { id } = await resp.json();
  return id;
}

async function renameFolder(id: string, newName: string) {
  const token = await getDriveAccessToken();
  await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName }),
  });
}

async function deleteFolder(id: string) {
  const token = await getDriveAccessToken();
  await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

// Update the Notion page with the Drive folder ID
async function setDriveIdOnPage(pageId: string, folderId: string) {
  await notion.pages.update({
    page_id: pageId,
    properties: { "Drive Folder ID": { rich_text: [{ text: { content: folderId } }] } },
  });
}

// Main HTTP server
serve(async (req) => {
  const rawBody = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Handle Notion's verification challenge before signature check
  if (payload.type === "verification") {
    return new Response(payload.challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  try {
    const signature = req.headers.get("Notion-Signature")!;
    // After initial setup, re-enable signature verification:
    // await verifySignature(rawBody, signature);
  } catch (err) {
    console.error("Signature verification failed:", err);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    for (const ev of payload.events) {
      const pageId = ev.subject.resourceId!;
      const page = await notion.pages.retrieve({ page_id: pageId });
      const titleProp = page.properties["Name"];
      const title = "title" in titleProp && titleProp.title[0]
        ? titleProp.title[0].plain_text
        : "Untitled";
      const existingDriveId = page.properties["Drive Folder ID"].rich_text[0]
        ? page.properties["Drive Folder ID"].rich_text[0].plain_text
        : null;

      switch (ev.eventType) {
        case "page.created": {
          const folderId = await createFolder(title);
          await setDriveIdOnPage(pageId, folderId);
          break;
        }
        case "page.updated": {
          if (existingDriveId) await renameFolder(existingDriveId, title);
          break;
        }
        case "page.deleted": {
          if (existingDriveId) await deleteFolder(existingDriveId);
          break;
        }
      }
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response("Error processing events", { status: 500 });
  }
});

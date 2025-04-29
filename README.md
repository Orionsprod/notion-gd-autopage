
# Notion ↔ Google Drive Folder Sync

This repository contains a Deno Deploy service that synchronizes a Notion database with Google Drive folders. When you create, rename, or delete a Notion page in the specified database, the service will create, rename, or trash a corresponding Google Drive folder.

## Setup

1. **Import to GitHub**  
   - Create a new repository and upload these files, or import this zip as a template.

2. **Provision a Google Service Account**  
   - Go to Google Cloud Console, enable the Drive API, and create a service account.  
   - Download the JSON key.  
   - Share the parent Drive folder (or your Drive root) with the service account’s email.

3. **Create a Notion Integration & Webhook**  
   - In [Notion Developers](https://developers.notion.com/), create an integration with **Read** & **Update** permissions on your target database.  
   - In your integration’s **Webhooks** tab, subscribe to your database for events `page.created`, `page.updated`, `page.deleted`.  
   - Copy the **Authorization** token and **Signing Secret**.

4. **Configure Deno Deploy**  
   - Sign in to [Deno Deploy](https://dash.deno.com/).  
   - Create a new project and connect your GitHub repo.  
   - In **Settings → Environment Variables**, add:  
     ```
     NOTION_API_KEY=<your Notion integration token>
     NOTION_WEBHOOK_SIGNING_SECRET=<your Notion webhook signing secret>
     GOOGLE_SERVICE_ACCOUNT_EMAIL=<your service account email>
     GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<the private key; preserve newline escapes>
     DRIVE_ROOT_FOLDER=<parent Drive folder ID; default: root>
     ```
   - Deploy the `main` branch.

5. **Test**  
   - Create a page in your Notion database → a new folder appears in Google Drive.  
   - Rename the Notion page → the folder renames.  
   - Delete the Notion page → the folder is trashed.

## Files

- **mod.ts** – Main handler for Notion webhooks and Drive operations.  
- **.env.example** – Example environment variables.  
- **.gitignore** – Ignore local `.env`.  
- **README.md** – This file.

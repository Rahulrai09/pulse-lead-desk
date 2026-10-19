# Pulse Lead Desk

Private CRM for the Pulse wheelchair store (Shopify). Only people added on the Team tab can sign in.

- Front end: this static site (GitHub Pages).
- Data and logins: Supabase (row-level security, Edge Functions sync Shopify every 10 minutes).
- `config.js` holds only the public publishable key. No secrets live in this repository.

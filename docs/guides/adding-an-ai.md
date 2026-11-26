# Adding an AI yourself

Any AI can be connected from **AI API Management** (`/providers`), with no developer and no settings file.
You need the `providers.manage` permission (tenant admins have it).

1. Click **Add AI** and pick a provider. Ones marked **Free tier** offer free use with limits; the offer is the
   provider's and can change.
2. Click **Get a key**, create a key on the provider's site, and paste it into **API key**. It is sealed at once
   and never shown again.
3. Click **Load models** and choose a model, or type its id. On OpenRouter, ids ending in `:free` cost nothing.
4. Enter your prices per million tokens (0 for a free tier), so budgets can be enforced, then click **Add AI**.
5. On the new card, click **Test**. One small fictional question is sent, metered like any call, and the result
   says whether it worked or why not.
6. Tick **Use this AI for model answers** and **Save**. Only one AI answers at a time.

## Any AI not in the list

Choose **Any other AI (OpenAI-compatible)**. Most AI services offer an OpenAI-style API; their docs give a base URL,
usually ending in `/v1`. Azure OpenAI sends its key in an `api-key` header, which the form offers.

## Safety rules the screen enforces

- Addresses must be `https://` and public. Local and private addresses (localhost, 10.x, 192.168.x, cloud metadata,
  `.internal`) are refused, and checked again on every call. A model you run yourself must be served at a public
  https address.
- If the API type or address of a saved connection changes, the key must be entered again, so a stored key is
  never sent somewhere new.
- Survey text is passed to the model as untrusted data, and no key ever appears in a prompt, log or error message.
- Every call, test and failure is recorded under **Recent model calls** with tokens, cost and model version.

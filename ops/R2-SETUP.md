# Cloudflare R2 setup for website photos

About 10 minutes, on a computer, in **dash.cloudflare.com**. Use the same Cloudflare account that has **rmj.co.in**.

The free tier is 10 GB of storage and 10 million photo views a month. Your website photos are about 20 MB, so it stays free. Cloudflare asks for a card anyway.

---

## Step 1: Turn on R2

1. Log in at **dash.cloudflare.com**.
2. In the left menu, click **R2 Object Storage**.
3. Click **Purchase R2 Plan** (it may say **Add R2 subscription to my account**). Choose the **Free** plan and add your card. Nothing is charged under the free limits.

## Step 2: Create the storage space ("bucket")

1. Still in R2, click **Create bucket**.
2. **Bucket name:** `rmj-media`
3. **Location:** Automatic. **Default storage class:** Standard.
4. Click **Create bucket**.

## Step 3: Give it your address, media.rmj.co.in

1. Open the **rmj-media** bucket, then the **Settings** tab.
2. Under **Public access** › **Custom Domains**, click **Connect Domain**.
3. Type `media.rmj.co.in`, then **Continue**, then **Connect domain**.
4. Wait until its status says **Active**, which usually takes 1–5 minutes.
5. Leave the **r2.dev subdomain** turned **off**. It isn't needed.

## Step 4: Let rmj.co.in read it (CORS)

1. In the same **Settings** tab, find **CORS Policy** and click **Add CORS policy** (or **Edit**).
2. Replace everything in the box with this and **Save**:

```json
[
  {
    "AllowedOrigins": ["https://rmj.co.in", "https://www.rmj.co.in"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 86400
  }
]
```

## Step 5: Create the key the app uses to upload

1. Go back to the **R2 Object Storage** overview page.
2. On the right, click **Manage API tokens** (or **{ } API** › **Manage API tokens**).
3. Click **Create API token**:
   - **Name:** `rmj-one-website`
   - **Permissions:** **Object Read & Write**
   - **Specify bucket(s):** **Apply to specific buckets only** › `rmj-media`
   - **TTL:** Forever
4. Click **Create API Token**. The next page shows the values **only once**. Copy these:
   - **Access Key ID**
   - **Secret Access Key**
   - Your **Account ID**: the long code in the line
     `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

## Step 6: Put the keys on the shop computer

1. On the shop computer, open this file in Notepad:
   `D:\RMJ-One\RMJ-One\backend\.env`
2. Add these 5 lines at the end, using your own values, then save:

```
R2_ACCOUNT_ID=paste-account-id-here
R2_ACCESS_KEY_ID=paste-access-key-id-here
R2_SECRET_ACCESS_KEY=paste-secret-access-key-here
R2_BUCKET=rmj-media
R2_PUBLIC_URL=https://media.rmj.co.in
```

> ⚠️ **Don't send me the Secret Access Key in chat.** It only goes into that file. The Account ID and the bucket name are fine to share.

## Step 7: Tell me "R2 done"

The keys take effect at the next **Deploy**, which restarts the server. After that, the app:

- copies the existing website photos to Cloudflare,
- sends every new photo there as you add it in Settings › Website,
- and rmj.co.in loads them from `media.rmj.co.in`.

Until the keys are in, everything keeps working exactly as it does today.

# 🚀 Simple Deployment — METRI Meeting Assistant

Follow these steps to deploy your **entire application** (Frontend + Backend) for free on **Render**.

---

## 1. Prepare your Code
Ensure all changes are pushed to your **GitHub repository**.

```bash
git add .
git commit -m "Configure unified deployment on Render"
git push origin main
```

---

## 2. Deploy Everything (One Click)

1.  Log in to [Render.com](https://render.com).
2.  Click **New +** → **Blueprint**.
3.  Connect your GitHub repository.
4.  Render will find the `render.yaml` file and show two services:
    *   **metri-backend** (Web Service)
    *   **metri-frontend** (Static Site)
5.  Click **Apply**.

---

## 3. Configure API Key
Render will start building, but the backend needs your OpenAI key.

1.  In the Render dashboard, go to the **metri-backend** service.
2.  Click **Environment** in the left sidebar.
3.  Find `OPENAI_API_KEY` and paste your `sk-...` key.
4.  Click **Save Changes**.

---

## 4. Verification Checklist
Once both services show a green "Live" status:

1.  Open the **metri-frontend** URL (found at the top of the frontend service page).
2.  **Auth**: Can you Sign Up and Log In?
3.  **Microphone**: Does the app ask for mic permission?
4.  **Transcription**: Do words appear every 5 seconds when you speak?
5.  **Library**: Can you save a session and see it in the library tab?

---

## 💡 Why is this better?
*   **No Circular URLs**: Render automatically connects the frontend and backend for you using the `render.yaml` settings.
*   **One Dashboard**: You can see logs and status for both parts of your app in one place.
*   **Automatic Updates**: Whenever you push code to GitHub, Render will automatically redeploy both the backend and frontend.

---

## ⚠️ Free Tier Note
On Render's free tier, the backend "goes to sleep" after 15 minutes of inactivity. When you first open the site after a break, it might take **30-60 seconds** to wake up. This is normal for free hosting.


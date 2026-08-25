# Brothers Gym Website - Complete Beginner's Guide

Welcome! This guide will help you manage your gym website even if you're a beginner. I'll explain everything step-by-step.

---

##  Folder Structure - Where to Put Your Files

### Recommended Structure

Create this folder structure on your computer:

```
Brothers Gym Website/
│
├── Frontend/                    ← ALL the website code goes here
│   ├── public/
│   │   └── images/
│   │       └── brothers-gym-logo.svg    ← Your logo file
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                 ← Main homepage (edit for contact info)
│   │   │   ├── admin/                   ← Admin panel (private)
│   │   │   └── owner-secure-access-1622/← Hidden admin login
│   │   └── db/
│   │       └── schema.ts                ← Database structure
│   ├── package.json                     ← Dependencies list
│   ├── .env                             ← Passwords & secrets (NEVER share this!)
│   └── ...other config files
│
└── GUIDE.md                             ← This file you're reading
```

### Important Rules

1. **Keep all code in the `Frontend/` folder** - This is what you'll upload to hosting
2. **Never share your `.env` file** - It contains your passwords
3. **Images go in `public/images/`** - This is where the website looks for images

---

## 🖼️ How to Change the Logo

### Step 1: Prepare Your Logo
- Format: **SVG** (best) or **PNG** (with transparent background)
- Size: At least **512x512 pixels** for good quality
- Name it: `brothers-gym-logo.svg` or `brothers-gym-logo.png`

### Step 2: Replace the Logo File
1. Open your `Frontend/` folder
2. Navigate to: `public/images/`
3. Delete the existing `brothers-gym-logo.svg`
4. Copy your new logo file into this folder
5. Make sure it's named exactly: `brothers-gym-logo.svg` (or `.png`)

### Step 3: If Using PNG Instead of SVG
If your logo is a PNG file, update this line in `src/app/page.tsx`:

**Find this:**
```tsx
<img src="/images/brothers-gym-logo.svg" alt="Brothers Gym logo" ... />
```

**Change to:**
```tsx
<img src="/images/brothers-gym-logo.png" alt="Brothers Gym logo" ... />
```

Do this replacement in these files:
- `src/app/page.tsx` (appears 3 times)
- `src/app/admin/layout.tsx` (appears 2 times)
- `src/app/owner-secure-access-1622/page.tsx` (appears 1 time)

---

## 📸 How to Change Trainer/Owner Photos

### Option A: Add Photos Through Admin Panel (Easiest)
1. Login to admin: `your-domain.com/owner-secure-access-1622`
2. Go to **Trainers** section
3. Click **Add Trainer / Owner**
4. In the **Photo URL** field, paste a link to your photo

### Where to Host Trainer Photos (Free Options)

**Option 1: Cloudinary (Recommended)**
1. Go to https://cloudinary.com
2. Create free account
3. Upload your trainer photos
4. Copy the image URL they give you
5. Paste it in the admin panel

**Option 2: Imgur**
1. Go to https://imgur.com
2. Upload image (no account needed)
3. Right-click the image → "Copy Image Address"
4. Paste in admin panel

**Option 3: Google Drive (Advanced)**
1. Upload photo to Google Drive
2. Right-click → Share → "Anyone with link can view"
3. Use a Drive-to-direct-link converter tool

### Option B: Add Photos Locally (For Developers)
1. Put photos in `public/images/trainers/`
2. Name them: `trainer-john.png`, `trainer-sarah.png`, etc.
3. In admin panel, use URL: `/images/trainers/trainer-john.png`

---

## 📞 How to Change Contact Information

### Edit the Homepage File

**File Location:** `Frontend/src/app/page.tsx`

### Step 1: Find the Contact Section
Scroll to the bottom of the file (around line 145-165). Look for this section:

```tsx
{/* Contact Footer */}
<footer id="contact" ...>
```

### Step 2: Change Phone Number

**Find this:**
```tsx
<a href="tel:+15551234567" ...>+1 (555) 123-4567</a>
```

**Change to your number (format: no spaces, no dashes, include country code):**
```tsx
<a href="tel:+919876543210" ...>+91 98765 43210</a>
```

### Step 3: Change Address & Google Maps Link

**Find this:**
```tsx
<a 
  href="https://www.google.com/maps/search/?api=1&query=123+Fitness+Street+Muscle+City+MC+90210" 
  ...
>
  123 Fitness Street, Muscle City, MC 90210
</a>
```

**Change to your address:**
1. Go to Google Maps
2. Search your gym's exact address
3. Click "Share" → "Copy Link"
4. Replace the `href="..."` URL with your Google Maps link

**Example for India:**
```tsx
<a 
  href="https://goo.gl/maps/YourShortLinkHere" 
  target="_blank" 
  rel="noopener noreferrer"
  className="hover:text-yellow-500 transition-colors"
>
  Shop No. 5, Main Market, Sector 21, Delhi, 110001
</a>
```

### Step 4: Change Opening Hours

**Find this section:**
```tsx
<ul className="space-y-3 text-zinc-400">
  <li className="flex justify-between..."><span>Mon - Fri</span> <span>5:00 AM - 11:00 PM</span></li>
  <li className="flex justify-between..."><span>Saturday</span> <span>6:00 AM - 9:00 PM</span></li>
  <li className="flex justify-between"><span>Sunday</span> <span>8:00 AM - 6:00 PM</span></li>
</ul>
```

**Change the times to match your gym:**
```tsx
<li><span>Mon - Fri</span> <span>5:00 AM - 10:00 PM</span></li>
<li><span>Saturday</span> <span>6:00 AM - 8:00 PM</span></li>
<li><span>Sunday</span> <span>Closed</span></li>
```

---

##  Admin Login - How to Access & Change Password

### Current Default Login (For Testing Only)
- **URL:** `your-domain.com/owner-secure-access-1622`
- **Email:** `owner@brothersgym.local`
- **Password:** `admin123`

### ️ IMPORTANT: Change Password Before Going Live!

**File Location:** `Frontend/.env`

**Add these lines:**
```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
ADMIN_EMAIL=your-real-email@gmail.com
ADMIN_PASSWORD=YourVeryStrongPassword123!
```

**Password Tips:**
- Use at least 12 characters
- Mix uppercase, lowercase, numbers, and symbols
- Example: `BrothersGym@Owner#2026!Secure`
- **Never share this password publicly**

---

## 🌐 How to Deploy (Make Website Live on Internet)

### Option 1: Vercel (Easiest & Free)

**Step 1: Prepare Your Code**
1. Make sure all your code is in the `Frontend/` folder
2. Create a GitHub account at https://github.com
3. Upload your `Frontend/` folder to a new GitHub repository

**Step 2: Deploy to Vercel**
1. Go to https://vercel.com
2. Sign up with your GitHub account
3. Click "Add New Project"
4. Select your Brothers Gym repository
5. Click "Deploy"

**Step 3: Set Environment Variables**
1. In Vercel dashboard, go to your project Settings
2. Find "Environment Variables"
3. Add these:
   - `DATABASE_URL` = Your database connection string
   - `ADMIN_EMAIL` = Your admin email
   - `ADMIN_PASSWORD` = Your strong password

**Step 4: Get a Custom Domain (Optional)**
1. Buy domain from GoDaddy/Namecheap (e.g., `brothersgym.com`)
2. In Vercel Settings → Domains → Add your domain
3. Follow Vercel's DNS instructions
4. Wait 24-48 hours for DNS to propagate

### Option 2: Railway + Vercel (For Database)

For a complete setup with database:

1. **Database:** Use https://neon.tech (free PostgreSQL hosting)
   - Create account
   - Create new project
   - Copy connection string
   - Add to Vercel environment variables as `DATABASE_URL`

2. **Website:** Use Vercel (as shown above)

---

##  How to Get on Google Search

### Step 1: Submit to Google Search Console
1. Go to https://search.google.com/search-console
2. Add your website URL
3. Verify ownership (Vercel makes this easy)
4. Submit your sitemap

### Step 2: Add SEO Keywords
In `src/app/layout.tsx`, update the metadata:

```tsx
export const metadata: Metadata = {
  title: "Brothers Gym - Best Gym in [Your City]",
  description: "Join Brothers Gym in [Your City]. Personal training, modern equipment, expert coaches. Start your fitness journey today!",
};
```

### Step 3: Create Google My Business
1. Go to https://www.google.com/business
2. Add your gym location
3. Add photos, hours, and contact info
4. This helps you show up in local Google Maps searches

---

## 🛠️ Common Tasks Quick Reference

### Change Logo
```
Location: public/images/brothers-gym-logo.svg
Action: Replace with your new logo file (same name)
```

### Change Phone Number
```
Location: src/app/page.tsx (line ~160)
Find: href="tel:+15551234567"
Change: Your number in international format
```

### Change Address/Maps
```
Location: src/app/page.tsx (line ~155)
Find: Google Maps href URL
Change: Your Google Maps share link
```

### Change Opening Hours
```
Location: src/app/page.tsx (line ~170)
Find: <li> tags with day/time
Change: Your gym's hours
```

### Change Admin Password
```
Location: .env file
Add: ADMIN_PASSWORD=YourNewStrongPassword
```

### Add New Trainer
```
Action: Login to admin panel → Trainers → Add Trainer
Fill: Name, Photo URL, Experience, PT Fee
```

### Export Member List
```
Action: Login to admin panel → Members → Export Excel/PDF
```

---

## 🆘 Troubleshooting

### Logo Not Showing
- Check file name is exactly `brothers-gym-logo.svg` or `.png`
- Check file is in `public/images/` folder
- Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)

### Admin Login Not Working
- Check `.env` file has `ADMIN_EMAIL` and `ADMIN_PASSWORD`
- Restart the development server after changing `.env`
- Make sure you're using `/owner-secure-access-1622` not `/login`

### Changes Not Appearing
- Save all files
- Stop the development server (Ctrl+C)
- Run `npm run dev` again
- Hard refresh browser (Ctrl+Shift+R)

### Database Errors
- Run: `npx drizzle-kit push` to update database schema
- Check `DATABASE_URL` in `.env` is correct

---

## 📞 Need Help?

### Useful Commands
```bash
# Start development server
npm run dev

# Build for production
npm run build

# Update database schema
npx drizzle-kit push

# Check for errors
npm run typecheck
```

### File Locations Summary

| What to Change | File Location |
|---------------|---------------|
| Logo | `public/images/brothers-gym-logo.svg` |
| Homepage Content | `src/app/page.tsx` |
| Admin Password | `.env` |
| Trainer Photos | Admin Panel (online) |
| Member Data | Admin Panel → Members |
| Equipment Costs | Admin Panel → Equipment |
| Database Structure | `src/db/schema.ts` |

---

## ✅ Pre-Launch Checklist

Before making your website public:

- [ ] Change admin password to something strong
- [ ] Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`
- [ ] Replace logo with your actual gym logo
- [ ] Update phone number to your real number
- [ ] Update address and Google Maps link
- [ ] Update opening hours
- [ ] Add at least one owner profile with photo
- [ ] Test admin login works
- [ ] Test member export (Excel/PDF) works
- [ ] Test on mobile phone
- [ ] Remove any test/dummy member data

---

**Good luck with Brothers Gym! 💪**

Remember: The admin portal is hidden at `/owner-secure-access-1622` - keep this URL private!

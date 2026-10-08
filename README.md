# Ornomart Spin & Win

The user enters their name and mobile number → the Spin Wheel opens → the coupon the wheel stops on is the user's coupon.
The store owner decides which user gets which coupon from the admin page.
Returning users see the coupon they already won.

## Files

| File | Purpose |
|---|---|
| `index.html`, `app.js` | User page (form + spin wheel + "Your Coupon" for returning users) |
| `admin.html`, `admin.js` | Owner's admin panel |
| `common.js` | Shared helpers + Supabase client |
| `config.js` | Supabase URL and publishable key |
| `style.css` | Ornomart theme (Cinzel font, logo colors) |
| `assets/` | Logo |
| `supabase/schema.sql` | Database tables, security rules, and spin logic |

## How the coupon is decided (on the server)

1. **Specific mobile assignment** – the coupon the admin assigned to that number
2. **Next spin** – if the admin set a "next spin" coupon (clears after one use)
3. **Weighted random** – based on each coupon's chance

## Setup

1. Run `supabase/schema.sql` in your Supabase project's SQL Editor.
2. Create the admin account in Authentication → Users → **Add user** (with Auto Confirm on).
3. Make that user an admin:
   ```sql
   insert into public.spin_admins (user_id) select id from auth.users where email = 'admin@example.com';
   ```
4. Put your Supabase URL and publishable key in `config.js`.

## Run locally

```bash
npx http-server -p 5500 -c-1
```

- Game: http://localhost:5500
- Admin: http://localhost:5500/admin.html

## Fonts

- **Cinzel** – loaded automatically from Google Fonts.
- **Armoresa Aged** – place the font file at `fonts/ArmoresaAged.ttf` (or `.otf` / `.woff2`). If it is missing, Cinzel Decorative is used instead.

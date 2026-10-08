# Ornomart Spin & Win

User form bharta hai → Spin Wheel khulta hai → wheel jis coupon par rukta hai wahi user ka coupon.
Kis user ko kaunsa coupon milega, ye owner admin page se decide karta hai.

## Files

| File | Kaam |
|---|---|
| `index.html`, `app.js` | User page (form + spin wheel) |
| `admin.html`, `admin.js` | Owner ka admin panel |
| `common.js` | Shared helpers + Supabase client |
| `config.js` | Supabase URL aur publishable key |
| `style.css` | Ornomart theme (Cinzel font, logo colors) |
| `assets/` | Logo |
| `supabase/schema.sql` | Database tables, security rules aur spin logic |

## Coupon kaise decide hota hai (server par)

1. **Specific mobile assignment** – admin ne us number ko jo coupon diya
2. **Agla spin** – admin ne "next spin" set kiya ho to (ek baar use ke baad clear)
3. **Chance (weight)** ke hisaab se random

## Setup

1. Supabase project me `supabase/schema.sql` SQL Editor se run karo.
2. Authentication → Users → **Add user** se admin account banao (Auto Confirm on).
3. Us user ko admin banao:
   ```sql
   insert into public.spin_admins (user_id) select id from auth.users where email = 'admin@example.com';
   ```
4. `config.js` me apna Supabase URL aur publishable key daalo.

## Local chalana

```bash
npx http-server -p 5500 -c-1
```

- Game: http://localhost:5500
- Admin: http://localhost:5500/admin.html

## Fonts

- **Cinzel** – Google Fonts se apne aap load hota hai.
- **Armoresa Aged** – font file `fonts/ArmoresaAged.ttf` (ya `.otf` / `.woff2`) me rakho. Na ho to Cinzel Decorative dikhta hai.

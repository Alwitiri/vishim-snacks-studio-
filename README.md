# Vishim Snack Studio: Website + Admin

The website and admin panel for Vishim Snack Studio, Ooty. It needs only Node.js 18 or newer, with no packages to install.

## Run it

```bash
node server.js
```

- Website: http://localhost:3000
- Admin: http://localhost:3000/admin/

**The admin panel has no login.** /admin/ opens directly, so anyone who knows the URL can edit the site.
To turn the password login back on, set `REQUIRE_LOGIN=1` and `ADMIN_PASSWORD=yourPassword` (for example in Render → Environment).

To use a different port, run `PORT=8080 node server.js`.

## What the admin can do
- **Dashboard**: see stats, switch the store between open and closed, and approve new reviews
- **Menu**: add, edit and delete dishes; set the price, veg and popular tags; mark items sold out; upload photos (they are resized automatically)
- **Reviews**: reviews that customers send from the website wait here until you approve them. You can also add, edit, hide or delete reviews
- **Highlights**: change the round Momos / Noodles / Soup pictures on the homepage
- **Store**: edit the phone number, address, Maps link, hours, price range, announcement banner and all the website text
- **Account**: change the admin password

## Files
- `server.js`: the web server and API
- `seed.json`: the starting content, copied to `data/db.json` on first run
- `data/db.json`: the live data. **Back up this file.** Delete it to go back to the seed content.
- `public/`: the website (`index.html`, `css/`, `js/`), the admin panel (`admin/`) and the images (`assets/img/`). Uploaded photos are saved in `data/uploads/`

## Hosting
Use any host that runs Node 18 or newer and has a persistent disk (a VPS, Render with a disk, Railway and so on).
Keep the `data/` folder (it also holds uploaded photos) on persistent storage, and serve the site over HTTPS.

### Render
`render.yaml` sets up a Node web service (`node server.js`). On Render the web password setup is turned off:
set **ADMIN_PASSWORD** under Environment in the Render dashboard, and the server uses it on every start.
On the free plan the disk is temporary: menu/review changes made in the admin are lost when the service restarts or redeploys.
For permanent changes, add a Render Disk mounted at `/var/data` and set `DATA_DIR=/var/data` (paid plan), or edit `seed.json` and push.

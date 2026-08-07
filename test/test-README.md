# Snapshot testing — no dependencies

این دو فایل رو تو یه پوشه‌ی جدید به اسم `test/` توی ریشه‌ی پروژه بذار:
- test/snapshot.mjs
- test/__snapshots__.json

## اجرا
node test/snapshot.mjs

## اگه تغییری عمدی دادی و می‌خوای snapshot جدید رو به‌عنوان baseline قبول کنی:
node test/snapshot.mjs --update

فقط از قابلیت‌های خود Node (fs, path, url) استفاده می‌کنه — بدون npm install،
بدون package.json، بدون node_modules. کاملاً هم‌راستا با استقلال پروژه.

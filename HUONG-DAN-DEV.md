# Hướng dẫn DEV ZaloCRM (cho cả nhóm)

> Tài liệu này dành cho người **code thêm tính năng / sửa giao diện** ZaloCRM.
> Đọc kỹ phần "Backup & khôi phục" để **không bao giờ mất code** khi sửa hỏng.

---

## 0. Tổng quan công nghệ

| Phần | Công nghệ | Thư mục |
|------|-----------|---------|
| Giao diện (UI) | Vue 3 + Vuetify 3 + Pinia + Vite | `frontend/` |
| Tính năng (API) | Node.js 20 + Fastify 5 + Prisma 7 | `backend/` |
| Database | PostgreSQL 16 | (chạy riêng) |
| Realtime | Socket.IO | trong `backend/` |

Luồng khi chạy local:
```
Postgres (cổng 5432/5433) ← backend (cổng 3000) ← frontend (cổng 5173)
Trình duyệt → http://localhost:5173 → sửa code → tự cập nhật (hot-reload)
```

---

## 1. Cài đặt lần đầu (máy mới)

### Cần có sẵn
- **Node.js 20+** → https://nodejs.org
- **Git** → https://git-scm.com
- **PostgreSQL 16** (cách nhẹ, không cần Docker) → https://www.postgresql.org/download/windows/
  - Khi cài đặt mật khẩu superuser `postgres`, **nhớ kỹ mật khẩu này**.
  - *Hoặc* dùng Docker Desktop (cần WSL2 + reboot) rồi chạy `docker compose -f docker-compose.dev.yml up -d`.

### Lấy mã nguồn
```powershell
git clone https://github.com/NDat2k3/ZaloCRM.git D:\ZaloCRM
cd D:\ZaloCRM
git remote add upstream https://github.com/locphamnguyen/ZaloCRM.git   # để kéo update từ repo gốc
```

### Cài thư viện
```powershell
cd D:\ZaloCRM\backend ; npm install
cd D:\ZaloCRM\frontend ; npm install
```

### Tạo database + cấu hình backend
```powershell
# Tạo database (thay devpassword bằng mật khẩu postgres của bạn)
$env:PGPASSWORD="devpassword"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE zalocrm;"
```

Tạo file `backend\.env` (copy từ `backend\.env.example`) và sửa các dòng:
```
NODE_ENV=development
APP_URL=http://localhost:5173
JWT_SECRET=<chạy: openssl rand -hex 32>
ENCRYPTION_KEY=<chạy: openssl rand -hex 32>
DATABASE_URL=postgresql://postgres:devpassword@localhost:5432/zalocrm
```
> ⚠️ File `.env` chứa bí mật — **đã được .gitignore, KHÔNG BAO GIỜ commit**. Mỗi người tự tạo `.env` riêng.

### Tạo bảng trong database
```powershell
cd D:\ZaloCRM\backend
npx prisma generate          # tạo Prisma client
npm run db:push              # tạo bảng từ schema (dùng cho dev — KHÔNG dùng db:migrate vì lỗi thứ tự P3006)
```

---

## 2. Chạy dev hằng ngày

Mở **2 cửa sổ PowerShell**:

**Cửa sổ 1 — Backend** (phải nạp `.env` trước khi chạy):
```powershell
cd D:\ZaloCRM\backend
Get-Content .env | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
    $k,$v = $_ -split '=',2 ; Set-Item -Path "Env:$k" -Value $v
}
npm run dev      # API chạy ở http://localhost:3000
```

**Cửa sổ 2 — Frontend:**
```powershell
cd D:\ZaloCRM\frontend
npm run dev      # Mở http://localhost:5173
```

Rồi mở trình duyệt **http://localhost:5173**. Sửa file `.vue` hay code backend → lưu → tự cập nhật.

> 💡 Có thể dùng script `dev-start.ps1` (nếu có sẵn trên máy) để bật cả 2 bằng 1 lệnh.

---

## 3. Quy trình GIT cho cả nhóm

Mỗi người **không sửa thẳng lên `main`**. Làm theo nhánh (branch) để không đụng nhau:

### Mỗi lần làm 1 việc mới
```powershell
git checkout main
git pull origin main                 # lấy code mới nhất của nhóm
git checkout -b ten-tinh-nang        # tạo nhánh mới, vd: feature/them-nut-export
```

### Trong lúc code — commit thường xuyên (mỗi khi xong 1 phần nhỏ)
```powershell
git add -A
git commit -m "Mô tả ngắn việc vừa làm"
```
> Commit nhiều lần = nhiều "điểm lưu" để quay lại khi hỏng. **Đừng đợi xong hết mới commit.**

### Đẩy nhánh lên GitHub cho nhóm xem
```powershell
git push origin ten-tinh-nang
```
Rồi vào GitHub tạo **Pull Request** (PR) để gộp vào `main`. Người khác review xong mới merge.

### Lấy code mới của người khác về
```powershell
git checkout main
git pull origin main
```

### Cấp quyền cho người khác cùng làm
Trên GitHub: repo **NDat2k3/ZaloCRM** → **Settings → Collaborators → Add people** → nhập username GitHub của họ. Họ chỉ cần `git clone` về là làm được.

### Kéo bản cập nhật từ repo gốc (locphamnguyen)
```powershell
git fetch upstream
git merge upstream/main      # gộp tính năng mới của tác giả gốc vào code của nhóm
```

---

## 4. ⭐ BACKUP & KHÔI PHỤC khi code hỏng

Đây là phần quan trọng nhất. Git chính là công cụ backup — mỗi `commit` là 1 bản lưu có thể quay về.

### A. Trước khi sửa thứ gì rủi ro → tạo điểm lưu an toàn
```powershell
git add -A
git commit -m "Bản chạy tốt trước khi sửa X"     # mốc để quay về
```
Hoặc đánh dấu mốc quan trọng bằng **tag**:
```powershell
git tag ban-on-dinh-v1        # đặt tên mốc
git push origin ban-on-dinh-v1
```

### B. Sửa hỏng, muốn vứt hết thay đổi CHƯA commit → về lại bản commit gần nhất
```powershell
git restore .                 # bỏ mọi sửa đổi chưa commit (an toàn nhất)
# hoặc mạnh tay hơn:
git reset --hard HEAD         # về đúng commit gần nhất, xoá mọi thay đổi đang dở
```

### C. Muốn quay về 1 bản CŨ HƠN (đã commit rồi)
```powershell
git log --oneline             # xem danh sách commit, copy mã (vd a1b2c3d)
git reset --hard a1b2c3d      # quay toàn bộ code về commit đó
```
> ⚠️ `reset --hard` xoá các commit sau đó. Nếu muốn **giữ lịch sử** (an toàn hơn) thì dùng `revert`:
```powershell
git revert a1b2c3d            # tạo commit mới đảo ngược thay đổi của commit a1b2c3d
```

### D. Chỉ muốn lấy lại 1 FILE ở bản cũ (không đụng file khác)
```powershell
git checkout a1b2c3d -- duong-dan/file.vue
```

### E. Cất tạm thay đổi để thử bản sạch, rồi lấy lại
```powershell
git stash             # cất hết thay đổi đang dở (code về bản sạch)
# ... test thử ...
git stash pop         # lấy lại thay đổi vừa cất
```

### F. Backup DATABASE (dữ liệu, không phải code)
```powershell
# Sao lưu ra file
$env:PGPASSWORD="devpassword"
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U postgres -h localhost zalocrm > backup-zalocrm.sql

# Khôi phục lại
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost zalocrm < backup-zalocrm.sql
```

### 🔑 Nguyên tắc vàng để không bao giờ mất code
1. **Commit thường xuyên** (vài chục phút/lần) — mỗi commit là 1 điểm khôi phục.
2. **Push lên GitHub mỗi cuối ngày** — code có bản trên cloud, mất máy vẫn còn.
3. **Làm trên branch riêng**, không sửa thẳng `main`.
4. Trước khi thử thứ gì lớn/rủi ro → **commit hoặc tạo tag** làm mốc quay về.

---

## 5. Cấu trúc thư mục nhanh

```
ZaloCRM/
├── frontend/src/
│   ├── views/         ← các trang (mỗi .vue = 1 màn hình)
│   ├── components/    ← nút, bảng, dialog tái dùng
│   ├── layouts/       ← khung menu/sidebar/header
│   ├── router/        ← khai báo đường dẫn trang
│   ├── stores/        ← dữ liệu chung (Pinia)
│   └── api/           ← gọi API backend
├── backend/src/       ← logic API, theo module
│   └── prisma/schema.prisma  ← cấu trúc database
└── docker-compose.yml ← chạy bản production
```

---

## 6. Lưu ý
- **MinIO/Redis** chưa bật ở local → tính năng ảnh/lead Facebook tạm lỗi, phần khác chạy bình thường.
- KHÔNG mở Zalo Web trên trình duyệt khi 1 nick đang kết nối trong CRM (dễ rớt phiên).
- API Zalo không chính thức → test bằng **nick phụ**, tránh khoá nick chính.

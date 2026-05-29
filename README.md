# 演唱会日历系统

演唱会档期管理 Web 应用，包含前台展示（日历/场馆档期）和后台管理（增删改查）。
目前可使用网站：https://www.concert-kr.space
纯ai生成，不要问我，我也不懂代码！

## 功能

- **演唱会日历** — 月视图日历，显示每日演唱会
- **场馆档期** — 按场馆查看所有档期（演唱会 + 非演唱会占用）
- **用户反馈** — 前台可提交反馈信息，邮件通知开发者
- **管理后台** — 管理演唱会、场馆、非演唱会档期

## 技术栈

- Node.js + Express 后端
- 原生 HTML/CSS/JS 前端（Tailwind CSS CDN 可选）
- JSON 文件存储
- Nodemailer 邮件通知
- express-session 鉴权

## 安装

```bash
npm install
cp .env.example .env   # 编辑 .env 填入配置
npm start              # 启动服务器，默认 http://localhost:3001
```

## .env 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3001 |
| `SESSION_SECRET` | Session 密钥 | 随机字符串 |
| `ADMIN_USERNAME` | 管理员用户名 | admin |
| `ADMIN_PASSWORD` | 管理员密码 | admin123 |
| `DEV_EMAIL` | 接收反馈的邮箱 | - |
| `SMTP_HOST` | SMTP 服务器 | smtp.gmail.com |
| `SMTP_PORT` | SMTP 端口 | 587 |
| `SMTP_USER` | SMTP 用户名 | - |
| `SMTP_PASS` | SMTP 密码 | - |
| `SMTP_SECURE` | 是否 SSL | false |

## 使用流程

1. 启动后访问 `http://localhost:3001`
2. 前台页面初始为空（无数据）
3. 访问 `/admin` 登录管理后台（默认 admin / admin123）
4. **先添加场馆**，再添加演唱会和非演唱会档期
5. 前台页面即时显示最新数据

## 页面路由

| 路径 | 说明 |
|------|------|
| `/` | 演唱会日历页面 |
| `/venues` | 场馆档期页面 |
| `/admin` | 后台登录 |
| `/admin/dashboard` | 管理仪表盘 |

## API 接口

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/concerts` | 获取所有演唱会 |
| GET | `/api/venues` | 获取所有场馆 |
| GET | `/api/venue-bookings?venueId=xxx` | 获取某场馆非演唱会档期 |
| POST | `/api/user-feedback` | 提交反馈 `{name, email, message, page}` |

### 管理接口（需要登录）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/admin/login` | 登录 `{username, password}` |
| GET | `/api/admin/check` | 检查登录状态 |
| POST | `/api/admin/logout` | 登出 |
| POST | `/api/admin/concerts` | 创建/更新演唱会 |
| DELETE | `/api/admin/concerts/:id` | 删除演唱会 |
| POST | `/api/admin/venues` | 创建/更新场馆 |
| DELETE | `/api/admin/venues/:id` | 删除场馆 |
| POST | `/api/admin/venue-bookings` | 创建/更新非演唱会档期 |
| DELETE | `/api/admin/venue-bookings/:id` | 删除非演唱会档期 |

## 项目结构

```
concert-calendar/
├── server.js              # 入口
├── package.json
├── .env.example
├── utils/
│   ├── data.js            # JSON 文件读写
│   └── mail.js            # Nodemailer 邮件
├── middleware/
│   └── auth.js            # Session 鉴权
├── routes/
│   ├── api.js             # 公开 API
│   └── admin.js           # 管理 API
├── public/
│   ├── index.html         # 演唱会日历
│   ├── venues.html        # 场馆档期
│   ├── css/style.css
│   ├── js/utils.js
│   └── admin/
│       ├── login.html     # 后台登录
│       └── dashboard.html # 管理仪表盘
└── data/                  # 运行时自动创建 JSON 文件
```

## 注意事项

- 删除场馆时会检查是否有关联的演唱会或档期，有关联则拒绝删除
- 邮件功能未配置 SMTP 时，反馈内容会输出到控制台日志
- 首次使用需先登录后台添加数据，前台才有内容展示

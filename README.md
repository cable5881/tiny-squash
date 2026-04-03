# TinySquash

TinySquash 是一个部署在 Cloudflare Pages 上的轻量图片压缩工具，现已支持 **Google OAuth 登录**。

## 本次新增

- Cloudflare Pages Functions 登录接口
- Google OAuth 2.0 授权登录
- HttpOnly Cookie 会话
- 前端登录状态展示 / 退出登录

## 目录结构

```txt
public/                    前端静态资源
functions/                 Cloudflare Pages Functions
  _lib/auth.js             Cookie / session / auth 工具
  api/auth/google/login.js 发起 Google 登录
  api/auth/google/callback.js Google 回调处理
  api/auth/me.js           获取当前登录用户
  api/auth/logout.js       退出登录
```

## 本地开发

### 1. 安装依赖

```bash
cd /root/github/tiny-squash
npm install
```

### 2. 配置环境变量

新建 `.dev.vars`：

```env
GOOGLE_CLIENT_ID=你的_google_client_id
GOOGLE_CLIENT_SECRET=你重新生成后的_google_client_secret
SESSION_SECRET=请填写一个足够长的随机字符串
APP_BASE_URL=http://localhost:8788
```

> 注意：你之前发出来的 Client Secret 已经暴露，**强烈建议先去 Google Cloud Console 重新生成一个新的 secret**，再填到 `.dev.vars`。

### 3. 在 Google Cloud Console 配置 OAuth

在 **Authorized redirect URIs** 中添加：

```txt
http://localhost:8788/api/auth/google/callback
```

如果你部署到正式域名，还要再增加：

```txt
https://你的域名/api/auth/google/callback
```

### 4. 启动本地开发

```bash
npm run dev
```

然后打开：

```txt
http://localhost:8788
```

## 部署到 Cloudflare Pages

### Pages 环境变量

在 Cloudflare Pages 项目里配置：

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `APP_BASE_URL`

### 部署

```bash
npm run deploy
```

## 登录流程说明

1. 前端点击“使用 Google 登录”
2. 跳转到 `/api/auth/google/login`
3. Functions 生成 `state` 并跳转 Google 授权页
4. Google 回调 `/api/auth/google/callback`
5. Functions 用 `code + client secret` 换取 access token
6. 读取用户信息，签发 TinySquash 自己的 session cookie
7. 前端通过 `/api/auth/me` 获取当前用户资料

## 安全说明

- **不要把 Client Secret 写进前端代码**
- Session 存在 `HttpOnly Cookie`
- 已做 `state` 校验，防止 OAuth CSRF
- 建议生产环境始终使用 HTTPS

## 后续可继续增强

如果你要，我下一步还可以继续帮你加：

- 登录后上传历史记录
- 用户专属压缩配置保存
- Supabase / D1 用户表持久化
- 白名单域邮箱登录限制
- 管理员后台

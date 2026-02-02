# MoveCar - 挪车通知系统

基于 Cloudflare Workers 的智能挪车通知系统，扫码即可通知车主，保护双方隐私。

## 界面预览

| 请求者页面 | 车主页面 |
|:---:|:---:|
| [🔗 在线预览](https://htmlpreview.github.io/?https://github.com/lesnolie/movecar/blob/main/preview-requester.html) | [🔗 在线预览](https://htmlpreview.github.io/?https://github.com/lesnolie/movecar/blob/main/preview-owner.html) |

## 为什么需要它？

- 🚗 **被堵车却找不到车主** - 干着急没办法
- 📱 **传统挪车码暴露电话** - 隐私泄露、骚扰电话不断
- 😈 **恶意扫码骚扰** - 有人故意反复扫码打扰
- 🤔 **路人好奇扫码** - 并不需要挪车却触发通知

## 这个系统如何解决？

- ✅ **不暴露电话号码** - 通过推送通知联系，保护隐私
- ✅ **双向位置共享** - 车主可确认请求者确实在车旁
- ✅ **无位置延迟 30 秒** - 降低恶意骚扰的动力
- ✅ **免费部署** - Cloudflare Workers 免费额度完全够用
- ✅ **无需服务器** - Serverless 架构，零运维成本

## 为什么使用 Bark 推送？

- 🔔 支持「紧急 / 重要 / 警告」通知级别
- 🎵 可自定义通知音效
- 🌙 **即使开启勿扰模式也能收到提醒**
- 📱 安卓用户：原理相通，将 Bark 替换为安卓推送服务即可（如 Pushplus、Server酱）

## 使用流程

### 请求者（需要挪车的人）

1. 扫描车上的二维码，进入通知页面
2. 填写留言（可选），如「挡住出口了」
3. 允许获取位置（不允许则延迟 30 秒发送）
4. 点击「通知车主」
5. 等待车主确认，可查看车主位置

### 车主

1. 收到 Bark 推送通知
2. 点击通知进入确认页面
3. 查看请求者位置（判断是否真的在车旁）
4. 点击确认，分享自己位置给对方

### 流程图

```
请求者                              车主
  │                                  │
  ├─ 扫码进入页面                     │
  ├─ 填写留言、获取位置                │
  ├─ 点击发送                         │
  │   ├─ 有位置 → 立即推送 ──────────→ 收到通知
  │   └─ 无位置 → 30秒后推送 ────────→ 收到通知
  │                                  │
  ├─ 等待中...                        ├─ 查看请求者位置
  │                                  ├─ 点击确认，分享位置
  │                                  │
  ├─ 收到确认，查看车主位置 ←──────────┤
  │                                  │
  ▼                                  ▼
```

## 部署教程
version: '3'

services:
  movecar:
    # 自动拉取我刚配置好的镜像（构建需要几分钟）
    image: ghcr.io/a-xizaoqin/movecar:main
    container_name: movecar
    ports:
      - "3000:3000"
    volumes:
      # 数据持久化，防止重启丢失
      - ./data:/app/data
    environment:
      # 必填：你的 Bark 推送地址
      - BARK_URL=https://api.day.app/换成你的KEY
      # 选填：备用联系电话
      - PHONE_NUMBER=
    restart: unless-stopped


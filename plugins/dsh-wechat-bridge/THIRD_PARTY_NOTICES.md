# 第三方声明

## 协议实现参考

`lib/weixin-api.mjs` 里腾讯 iLink（微信 AI 机器人）的接口路径、请求头与消息形状，参考自：

- **@xmanrui/dsh-im** — MIT License
  https://github.com/xmanrui/dsh-im
  参考文件：`src/channels/weixin/weixin-api.mjs`（扫码登录、getupdates、sendmessage、notify*）

本插件只保留文字收发所需的最小实现，没有复制其桥接层、客户端 UI、文件/图片/语音、审批与命令系统。

## 其他

- 协议调用的目标域名：`https://ilinkai.weixin.qq.com/`（只信任 `*.weixin.qq.com`）。
- 本插件不内置任何第三方运行时依赖，只用 Node 内置模块（`node:crypto`、`node:fs` 等）。

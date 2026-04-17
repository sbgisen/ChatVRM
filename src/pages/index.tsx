import { useCallback, useContext, useEffect, useState } from "react";
import VrmViewer from "@/components/vrmViewer";
import { ViewerContext } from "@/features/vrmViewer/viewerContext";
import {
  Message,
  textsToScreenplay,
  Screenplay,
  ContentPart,
} from "@/features/messages/messages";
import { speakCharacter } from "@/features/messages/speakCharacter";
import { MessageInputContainer } from "@/components/messageInputContainer";
import { SYSTEM_PROMPT } from "@/features/constants/systemPromptConstants";
import { Menu } from "@/components/menu";
import { Meta } from "@/components/meta";
import { startCamera, stopCamera, captureFrame } from "@/features/camera/camera";

const TAP_PROMPT_DEFAULT = "やあ";
const TAP_PROMPT_VISION = "何が見える？";

export default function Home() {
  const { viewer } = useContext(ViewerContext);

  const envDefaults = {
    lmStudioUrl: process.env.NEXT_PUBLIC_LM_STUDIO_URL ?? "",
    lmStudioApiKey: process.env.NEXT_PUBLIC_LM_STUDIO_API_KEY ?? "",
    lmStudioModel: process.env.NEXT_PUBLIC_LM_STUDIO_MODEL ?? "",
    whisperUrl: process.env.NEXT_PUBLIC_WHISPER_URL ?? "http://localhost:8000",
    speakerId: Number(process.env.NEXT_PUBLIC_VOICEVOX_SPEAKER_ID ?? "3"),
  };

  const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT);
  const [lmStudioUrl, setLmStudioUrl] = useState(envDefaults.lmStudioUrl);
  const [lmStudioApiKey, setLmStudioApiKey] = useState(envDefaults.lmStudioApiKey);
  const [lmStudioModel, setLmStudioModel] = useState(envDefaults.lmStudioModel);
  const [whisperUrl, setWhisperUrl] = useState(envDefaults.whisperUrl);
  const [speakerId, setSpeakerId] = useState(envDefaults.speakerId);
  const [chatProcessing, setChatProcessing] = useState(false);
  const [speakingCount, setSpeakingCount] = useState(0);
  const [chatLog, setChatLog] = useState<Message[]>([]);
  const [assistantMessage, setAssistantMessage] = useState("");
  const [isSttEnabled, setIsSttEnabled] = useState(false);
  const [isVisionEnabled, setIsVisionEnabled] = useState(false);

  useEffect(() => {
    if (window.localStorage.getItem("chatVRMParams")) {
      const params = JSON.parse(
        window.localStorage.getItem("chatVRMParams") as string
      );
      setSystemPrompt(params.systemPrompt ?? SYSTEM_PROMPT);
      setLmStudioUrl(params.lmStudioUrl ?? envDefaults.lmStudioUrl);
      setLmStudioApiKey(params.lmStudioApiKey ?? envDefaults.lmStudioApiKey);
      setLmStudioModel(params.lmStudioModel ?? envDefaults.lmStudioModel);
      setWhisperUrl(params.whisperUrl ?? envDefaults.whisperUrl);
      setSpeakerId(params.speakerId ?? envDefaults.speakerId);
      setChatLog(params.chatLog ?? []);
    }
  }, []);

  useEffect(() => {
    process.nextTick(() =>
      window.localStorage.setItem(
        "chatVRMParams",
        JSON.stringify({
          systemPrompt,
          lmStudioUrl,
          lmStudioApiKey,
          lmStudioModel,
          whisperUrl,
          speakerId,
          chatLog,
        })
      )
    );
  }, [systemPrompt, lmStudioUrl, lmStudioApiKey, lmStudioModel, whisperUrl, speakerId, chatLog]);

  const handleChangeChatLog = useCallback(
    (targetIndex: number, text: string) => {
      const newChatLog = chatLog.map((v: Message, i) => {
        return i === targetIndex ? { role: v.role, content: text } : v;
      });

      setChatLog(newChatLog);
    },
    [chatLog]
  );

  /**
   * 文ごとに音声を直列でリクエストしながら再生する
   */
  const handleSpeakAi = useCallback(
    async (
      screenplay: Screenplay,
      onStart?: () => void,
      onEnd?: () => void
    ) => {
      speakCharacter(screenplay, viewer, speakerId, onStart, onEnd);
    },
    [viewer, speakerId]
  );

  const handleToggleStt = useCallback(() => {
    setIsSttEnabled((prev) => !prev);
  }, []);

  const handleToggleVision = useCallback(async () => {
    if (isVisionEnabled) {
      stopCamera();
      setIsVisionEnabled(false);
    } else {
      try {
        await startCamera();
        setIsVisionEnabled(true);
      } catch (e) {
        console.error("Failed to start camera:", e);
        setAssistantMessage("カメラの起動に失敗しました");
      }
    }
  }, [isVisionEnabled]);

  /**
   * アシスタントとの会話を行う
   */
  const handleSendChat = useCallback(
    async (text: string) => {
      if (!lmStudioUrl) {
        setAssistantMessage("LM StudioのURLが入力されていません");
        return;
      }

      const newMessage = text;

      if (newMessage == null) return;

      setChatProcessing(true);
      // ユーザーの発言を追加して表示
      const messageLog: Message[] = [
        ...chatLog,
        { role: "user", content: newMessage },
      ];
      setChatLog(messageLog);

      // LM Studioへ
      let messagesForApi: Message[] = [
        {
          role: "system",
          content: systemPrompt,
        },
        ...messageLog,
      ];

      if (isVisionEnabled) {
        const frame = captureFrame();
        if (frame) {
          const lastUserMsg = messagesForApi[messagesForApi.length - 1];
          const textContent =
            typeof lastUserMsg.content === "string"
              ? lastUserMsg.content
              : "";
          const contentParts: ContentPart[] = [
            { type: "text", text: textContent },
            { type: "image_url", image_url: { url: frame } },
          ];
          messagesForApi = [
            ...messagesForApi.slice(0, -1),
            { role: "user", content: contentParts },
          ];
        }
      }

      const res = await fetch("/api/chat-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: messagesForApi,
          apiKey: lmStudioApiKey,
          baseUrl: lmStudioUrl,
          model: lmStudioModel,
        }),
      });

      if (!res.ok) {
        console.error("Error from API:", await res.text());
        setChatProcessing(false);
        return;
      }

      const reader = res.body!.getReader();
      let receivedMessage = "";
      let aiTextLog = "";
      let tag = "";
      const sentences = new Array<string>();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const decoder = new TextDecoder("utf-8");
          receivedMessage += decoder.decode(value, { stream: true });

          // 返答内容のタグ部分の検出
          const tagMatch = receivedMessage.match(/^\[(.*?)\]/);
          if (tagMatch && tagMatch[0]) {
            tag = tagMatch[0];
            receivedMessage = receivedMessage.slice(tag.length);
          }

          // 返答を一文単位で切り出して処理する
          const sentenceMatch = receivedMessage.match(
            /^(.+[。．！？\n]|.{10,}[、,])/
          );
          if (sentenceMatch && sentenceMatch[0]) {
            const sentence = sentenceMatch[0];
            sentences.push(sentence);
            receivedMessage = receivedMessage
              .slice(sentence.length)
              .trimStart();

            // 発話不要/不可能な文字列だった場合はスキップ
            if (
              !sentence.replace(
                /^[\s\[\(\{「［（【『〈《〔｛«‹〘〚〛〙›»〕》〉』】）］」\}\)\]]+$/g,
                ""
              )
            ) {
              continue;
            }

            const aiText = `${tag} ${sentence}`;
            const aiTalks = textsToScreenplay([aiText]);
            aiTextLog += aiText;

            // 文ごとに音声を生成 & 再生、返答を表示
            const currentAssistantMessage = sentences.join(" ");
            setSpeakingCount((c) => c + 1);
            handleSpeakAi(
              aiTalks[0],
              () => {
                setAssistantMessage(currentAssistantMessage);
              },
              () => {
                setSpeakingCount((c) => c - 1);
              }
            );
          }
        }
      } catch (e) {
        setChatProcessing(false);
        console.error(e);
      } finally {
        reader.releaseLock();
      }

      // アシスタントの返答をログに追加
      const messageLogAssistant: Message[] = [
        ...messageLog,
        { role: "assistant", content: aiTextLog },
      ];

      setChatLog(messageLogAssistant);
      setChatProcessing(false);
    },
    [
      systemPrompt,
      chatLog,
      handleSpeakAi,
      lmStudioUrl,
      lmStudioApiKey,
      lmStudioModel,
      speakerId,
      isVisionEnabled,
    ]
  );

  const isBusy = chatProcessing || speakingCount > 0;

  const handleTapVrm = useCallback(() => {
    const prompt = isVisionEnabled ? TAP_PROMPT_VISION : TAP_PROMPT_DEFAULT;
    handleSendChat(prompt);
  }, [isVisionEnabled, handleSendChat]);

  return (
    <div className={"font-M_PLUS_2"}>
      <Meta />
      <VrmViewer onTap={handleTapVrm} disabled={isBusy} />
      <MessageInputContainer
        isChatProcessing={chatProcessing}
        isSttEnabled={isSttEnabled}
        isVisionEnabled={isVisionEnabled}
        whisperUrl={whisperUrl}
        onChatProcessStart={handleSendChat}
        onToggleStt={handleToggleStt}
        onToggleVision={handleToggleVision}
      />
      <Menu
        lmStudioUrl={lmStudioUrl}
        lmStudioApiKey={lmStudioApiKey}
        lmStudioModel={lmStudioModel}
        systemPrompt={systemPrompt}
        chatLog={chatLog}
        speakerId={speakerId}
        assistantMessage={assistantMessage}
        onChangeLmStudioUrl={setLmStudioUrl}
        onChangeLmStudioApiKey={setLmStudioApiKey}
        onChangeLmStudioModel={(e) => setLmStudioModel(e.target.value)}
        whisperUrl={whisperUrl}
        onChangeWhisperUrl={setWhisperUrl}
        onChangeSystemPrompt={setSystemPrompt}
        onChangeChatLog={handleChangeChatLog}
        onChangeSpeakerId={(e) => setSpeakerId(parseInt(e.target.value))}
        handleClickResetChatLog={() => setChatLog([])}
        handleClickResetSystemPrompt={() => setSystemPrompt(SYSTEM_PROMPT)}
        handleClickResetAllSettings={() => {
          window.localStorage.removeItem("chatVRMParams");
          window.location.reload();
        }}
      />
    </div>
  );
}

// Built-in style: one person saying one thing to the camera, in a single take.
import type { Style } from "../domain.ts";

export const founderOnCamera: Style = {
  id: "founder-on-camera",
  title: "Founder talking to camera",
  kind: "video",
  aspects: ["9:16", "16:9"],
  channels: ["tiktok", "instagram", "youtube", "linkedin", "threads", "facebook", "telegram"],
  slots: {
    founder: "Who is on camera, as a noun phrase: age, look and clothes, or \"the person in the start image\" when a still is passed with --start-image. Example: a woman in her thirties with short dark hair, in a grey crewneck",
    setting: "Where they sit, as a noun phrase. Example: a bright home office with a bookshelf behind them",
    language: "The language of the spoken line. Example: English",
    line: "The words spoken, exactly: one or two short sentences, about twenty words for eight seconds, no quotation marks",
  },
  prompt: [
    "Talking-head video in one continuous take.",
    "{{founder}}, in {{setting}}, framed from the chest up with the eyes on the upper third, looks straight into the lens and says in {{language}}, naturally and with conviction: \"{{line}}\"",
    "Conversational tone, small hand gestures inside the frame, real blinking, lips in sync with the words.",
    "Camera at eye level with the barely noticeable movement of a hand-held shot, 35mm look, soft window light from one side, a softly blurred background with depth.",
    "A clear voice over quiet room tone, no music.",
    "The lower fifth of the frame stays free of important detail, for captions.",
    "No on-screen text, no subtitles, no logos, no cuts, no zooms.",
  ].join(" "),
  models: { higgsfield: "veo3_1" },
  params: { duration: "8" },
  version: 1,
  use: "One idea said to the camera: a launch in one sentence, the answer to a common question, a lesson of the week. For the real founder, pass an approved still of them with --start-image, so the face is theirs; without one the speaker is an invented person.",
  copy: "The caption repeats the point of the spoken line in its first sentence, for viewers with the sound off. Then one line of context and one call to action. Say that the video is AI-generated.",
  avoid: "A real, named person without their written consent, or anyone a viewer could take for one. Lines over twenty words: the speech gets rushed or cut. Claims in the spoken line that are not in the pack's claims.",
};

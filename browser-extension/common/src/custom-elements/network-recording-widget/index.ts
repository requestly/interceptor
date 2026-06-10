import styles from "./index.css";
import { registerCustomElement, setInnerHTML } from "../utils";
import { RQDraggableWidget } from "../abstract-classes/draggable-widget";

/**
 * Minimal floating widget shown on a recorded tab WHEN the network-recording side panel is closed.
 * Lets the user reopen the panel (click → "reopen" event → content script → SW → sidePanel.open).
 * Top-right, draggable. Enrich later (status counts etc.) once the reopen path is verified.
 */

enum RQNetworkRecordingWidgetEvent {
  REOPEN = "reopen",
}

const TAG_NAME = "rq-network-recording-widget";
const DEFAULT_POSITION = { top: 16, right: 16 };

class RQNetworkRecordingWidget extends RQDraggableWidget {
  constructor() {
    super(DEFAULT_POSITION);
    this.shadowRoot = this.attachShadow({ mode: "closed" });
    setInnerHTML(this.shadowRoot, this._getDefaultMarkup());

    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    this.addListeners();
    // Show on connect (like the session-recording widget). The element is only created when we
    // want it shown, and this avoids a race where the content script dispatches "show" before
    // this listener is registered (custom-element upgrade is async after createElement/append).
    this.show();
  }

  addListeners() {
    this.shadowRoot.querySelector(".reopen").addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.dispatchEvent(new CustomEvent(RQNetworkRecordingWidgetEvent.REOPEN));
    });

    this.addEventListener("show", (evt: CustomEvent) => this.show(evt.detail?.position));
    this.addEventListener("hide", this.hide);
  }

  _getDefaultMarkup() {
    return `
      <style>${styles}</style>
      <div id="container">
        <span class="recording-dot" title="Recording"></span>
        <span class="reopen" title="Reopen the recording panel">Open panel</span>
      </div>
    `;
  }

  show(position = DEFAULT_POSITION) {
    this.moveToPostion(position);
    this.setAttribute("draggable", "true");
    this.shadowRoot.querySelector("#container").classList.add("visible");
  }

  hide() {
    this.shadowRoot.querySelector("#container").classList.remove("visible");
  }
}

registerCustomElement(TAG_NAME, RQNetworkRecordingWidget);

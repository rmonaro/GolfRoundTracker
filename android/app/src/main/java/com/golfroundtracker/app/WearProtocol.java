package com.golfroundtracker.app;

/**
 * The phone↔watch wire contract, in one place.
 *
 * Mirrored verbatim by `wear/.../WearProtocol.kt`. The two modules cannot share
 * a class (one is Java in a Capacitor-generated module, the other Kotlin in a
 * Wear module) so they share a spec instead — change one, change both. Every
 * string here is a Data Layer path or a JSON key that a mismatched constant
 * would break silently, with no compile error and no runtime exception: the
 * message simply never arrives.
 *
 * WHY THESE SHAPES. The watchOS app moves state over `updateApplicationContext`
 * (latest-wins, coalescing, survives the app being asleep) and moves events back
 * over `sendMessage` with a `transferUserInfo` fallback (queued, guaranteed,
 * FIFO). The Data Layer splits along the same seam:
 *
 *   • DataClient    — a single data item at ROUND_STATE_PATH, overwritten on
 *                     every push. That IS latest-wins coalescing, and the watch
 *                     reads the last value on launch without the phone
 *                     re-sending. The direct analogue of applicationContext.
 *   • MessageClient — fire-and-forget, delivered only when a node is connected.
 *                     Right for commands, which are meaningless late.
 *
 * The gap worth knowing: MessageClient has NO queued fallback. `transferUserInfo`
 * on watchOS guarantees eventual delivery of a recorded shot; a Wear message
 * sent to a disconnected node is simply lost. Phase 2 handles that by writing
 * watch→phone events as data items too, which do persist. Phase 1 only carries
 * commands, which are fine to drop.
 */
public final class WearProtocol {
    private WearProtocol() {}

    /**
     * Capability the WATCH app declares (in its `wear.xml`) and the phone looks
     * for. Node ids alone are not enough — a paired watch that has never
     * installed the app is still a node, and messages to it vanish.
     */
    public static final String CAPABILITY_WEAR_APP = "grt_wear_app";

    /**
     * Round snapshot, phone → watch. One item, overwritten in place.
     *
     * Data items are deduplicated BY CONTENT: putting an identical payload twice
     * fires no listener on the watch. Harmless here (an unchanged state needs no
     * redraw) but it is why `sentAt` is included — a resend of otherwise
     * identical state still lands.
     */
    public static final String ROUND_STATE_PATH = "/grt/round-state";

    /** Commands, phone → watch. See CMD_* below. */
    public static final String COMMAND_PATH = "/grt/command";

    /** Events, watch → phone. Shot recorded, putt, hole change… (Phase 2). */
    public static final String FROM_WATCH_PATH = "/grt/from-watch";

    // --- DataMap keys on ROUND_STATE_PATH ------------------------------------

    /**
     * The whole WatchRoundState as a JSON string, not as individual DataMap
     * entries.
     *
     * Deliberate: the shape is owned by `src/services/watchBridge.ts` and grows
     * there. Mapping ~20 optional fields into typed DataMap keys would mean
     * touching three languages every time one is added, and DataMap has no
     * concept of "absent vs false" that survives the round trip cleanly. A JSON
     * blob keeps the phone plugin a pass-through.
     */
    public static final String KEY_STATE_JSON = "state";

    /** Epoch millis, so a re-push of identical state is still a new data item. */
    public static final String KEY_SENT_AT = "sentAt";

    // --- Watch → phone events -----------------------------------------------

    /**
     * Prefix for DURABLE watch → phone events. One data item per event, at
     * `/grt/from-watch/<eventId>`.
     *
     * Not a single fixed path, and not MessageClient. A recorded shot MUST NOT
     * be lost: MessageClient drops anything sent while the phone is out of
     * range or its process is dead, and a single shared path would have a
     * second shot overwrite the first before the phone read it. A data item per
     * event persists on the node until something deletes it, which is what
     * watchOS gets from `transferUserInfo`'s guaranteed FIFO queue.
     *
     * The phone DELETES each item once it has handed it to the WebView. That
     * delete is the acknowledgement — an event still present is an event not yet
     * delivered, so `WatchBridge` drains whatever is waiting when the WebView
     * comes back rather than losing it.
     */
    public static final String FROM_WATCH_QUEUE_PREFIX = "/grt/from-watch/";

    /** The event body: the same JSON `WatchInboundMessage` shape iOS sends. */
    public static final String KEY_EVENT_JSON = "event";

    /**
     * Ephemeral watch → phone updates — currently the live position while
     * tracking a shot.
     *
     * MessageClient on purpose, the opposite call to the queue above: these
     * arrive several times a minute and each one supersedes the last, so a lost
     * update costs nothing and a queue of stale positions would be worse than
     * useless. Delivered only while the phone is connected, which is also when
     * anybody could be looking at the map they feed.
     */
    public static final String LIVE_UPDATE_PATH = "/grt/live-update";

    // --- Command payload -----------------------------------------------------

    public static final String KEY_COMMAND = "command";
    /** Open the watch app into a practice session. */
    public static final String CMD_START_PRACTICE = "startPractice";
    /** Open the watch app on the round screen. */
    public static final String CMD_OPEN_ROUND = "openRound";
    /** End the watch's practice session (phone-initiated). */
    public static final String CMD_END_PRACTICE = "endPractice";
}

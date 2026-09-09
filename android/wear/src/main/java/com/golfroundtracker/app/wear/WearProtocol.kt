package com.golfroundtracker.app.wear

/**
 * Watch-side mirror of `app/.../WearProtocol.java`. See that file for why the
 * two are duplicated rather than shared, and for what each path carries.
 *
 * A drifted constant here fails SILENTLY — no compile error, no exception, the
 * message just never arrives. Change one, change both.
 */
object WearProtocol {
    const val CAPABILITY_WEAR_APP = "grt_wear_app"

    const val ROUND_STATE_PATH = "/grt/round-state"
    const val COMMAND_PATH = "/grt/command"
    const val FROM_WATCH_PATH = "/grt/from-watch"

    const val KEY_STATE_JSON = "state"
    const val KEY_SENT_AT = "sentAt"

    /** See the Java mirror for why events are data items and updates are not. */
    const val FROM_WATCH_QUEUE_PREFIX = "/grt/from-watch/"
    const val KEY_EVENT_JSON = "event"
    const val LIVE_UPDATE_PATH = "/grt/live-update"

    const val KEY_COMMAND = "command"
    const val CMD_START_PRACTICE = "startPractice"
    const val CMD_OPEN_ROUND = "openRound"
    const val CMD_END_PRACTICE = "endPractice"
}

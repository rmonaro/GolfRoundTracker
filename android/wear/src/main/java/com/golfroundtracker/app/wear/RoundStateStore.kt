package com.golfroundtracker.app.wear

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The round state the watch is currently holding, and where it came from.
 *
 * A process-wide singleton because the two writers are components the system
 * owns and constructs at will — `PhoneListenerService` (woken on delivery, quite
 * possibly with no Activity alive) and `MainActivity` (which reads the last data
 * item on launch). Handing state between them through anything narrower would
 * mean the service having a reference to an Activity that may not exist.
 *
 * In-memory only. If the process dies the state is gone — and that is correct
 * rather than lazy: `MainActivity` re-reads the DataClient item on every start,
 * and a data item persists on the node until it is overwritten. The phone's last
 * push IS the durable copy, so caching it here as well would only create a
 * second thing to keep in sync.
 */
object RoundStateStore {
    private val _state = MutableStateFlow(RoundState.NONE)
    val state: StateFlow<RoundState> = _state

    /**
     * True once anything has arrived from the phone in this process.
     *
     * Distinguishes "no round in progress" from "we have not heard from the
     * phone yet", which look identical in the state itself and need to read
     * very differently on a 1.7" screen — one is a normal resting state, the
     * other is a connection problem the user may need to act on.
     */
    private val _heardFromPhone = MutableStateFlow(false)
    val heardFromPhone: StateFlow<Boolean> = _heardFromPhone

    fun update(next: RoundState) {
        _heardFromPhone.value = true
        _state.value = next
    }
}

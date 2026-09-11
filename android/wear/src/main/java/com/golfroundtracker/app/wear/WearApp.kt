package com.golfroundtracker.app.wear

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText

/**
 * The round screen.
 *
 * Laid out the way the watchOS `HoleHomeView` is, and for the same reason: the
 * yardage is the only thing being read at arm's length mid-swing-decision, so it
 * takes the centre at display size and everything else arranges around it. The
 * controls sit in a 2×2 grid beneath — four is the most a thumb can hit reliably
 * on a round screen without a scroll.
 */
@Composable
fun WearApp(model: RoundViewModel = viewModel(), startInPractice: Boolean = false) {
    val screen by model.screen.collectAsStateWithLifecycle()
    val hasPermission by model.hasLocationPermission.collectAsStateWithLifecycle()
    val tracking by model.tracking.collectAsStateWithLifecycle()
    val practising by PracticeSession.active.collectAsStateWithLifecycle()
    val puttFeetOverride by model.puttFeetOverride.collectAsStateWithLifecycle()
    val puttSending by model.puttSending.collectAsStateWithLifecycle()
    // Local, not in the view model: which screen is on top is a property of
    // this composition, and it must not survive the app being reopened on a
    // different hole.
    var pickingClub by remember { mutableStateOf(false) }
    var tempoTrainer by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Launched by the phone with `startPractice`. Fires once — a recomposition
    // must not open a second session over the first, which would abandon the
    // swings already recorded into it.
    LaunchedEffect(startInPractice) {
        if (startInPractice && !practising) {
            PracticeSession.start(context, scope, screen.state.selectedClubId)
        }
    }

    // A STOPGAP request, not the real one.
    //
    // RoundService owns location now, and it starts when the phone says a round
    // is active — which may be seconds after this screen first appears, or not
    // at all if the user is just looking at the app. This covers that gap so the
    // screen has something to show; `onDispose` stops only this request, never
    // the service's.
    DisposableEffect(hasPermission) {
        model.startLocation()
        onDispose { model.stopLocation() }
    }

    // Feed the phone's map dot while a shot is being tracked.
    LaunchedEffect(screen.fix, tracking) {
        screen.fix?.let { model.publishPosition(it) }
    }

    // A ± correction belongs to the putt it was made for. Carrying it to the
    // next green would silently record the wrong distance there.
    LaunchedEffect(screen.state.holeNumber) { model.clearPuttOverride() }

    MaterialTheme {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            TimeText()
            when {
                // Practice wins over everything: it is an explicit thing the
                // golfer started, and it does not care whether a round is live
                // or whether the phone has been heard from.
                tempoTrainer -> TempoTrainerScreen(onClose = { tempoTrainer = false })
                practising -> PracticeScreen(onEnd = { PracticeSession.end(context) })
                !screen.heardFromPhone -> Message("Waiting for phone…")
                !screen.state.active -> NoRound(
                    onPractice = {
                        PracticeSession.start(context, scope, screen.state.selectedClubId)
                    },
                    onTempo = { tempoTrainer = true }
                )
                !hasPermission -> Message("Location off — open settings to let the watch measure")

                pickingClub -> ClubPickerScreen(
                    bag = screen.state.bag,
                    selectedClubId = screen.effectiveClubId,
                    onPick = { clubId ->
                        model.selectClub(clubId)
                        // Straight back to the round. Picking a club is a step
                        // on the way to a shot, never a destination.
                        pickingClub = false
                    }
                )

                // Putter in hand AND on the green — see RoundScreenModel.
                screen.isPutting -> PuttScreen(
                    feet = puttFeetOverride ?: (screen.distance as? Distance.Feet)?.value,
                    sending = puttSending,
                    onAdjust = { delta ->
                        model.adjustPutt(delta, (screen.distance as? Distance.Feet)?.value)
                    },
                    onRecord = { made ->
                        model.recordPutt(
                            made = made,
                            feet = puttFeetOverride ?: (screen.distance as? Distance.Feet)?.value,
                            fix = screen.fix,
                            clubId = screen.effectiveClubId
                        )
                    }
                )

                else -> RoundScreen(
                    screen = screen,
                    tracking = tracking,
                    model = model,
                    onPickClub = { pickingClub = true }
                )
            }
        }
    }
}

@Composable
private fun Message(text: String) {
    Text(
        text = text,
        textAlign = TextAlign.Center,
        style = MaterialTheme.typography.body2,
        color = MaterialTheme.colors.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 20.dp)
    )
}

@Composable
private fun RoundScreen(
    screen: RoundScreenModel,
    tracking: Boolean,
    model: RoundViewModel,
    onPickClub: () -> Unit
) {
    val state = screen.state
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = Modifier.fillMaxSize().padding(horizontal = 10.dp)
    ) {
        Text(
            text = buildString {
                append("Hole ${state.holeNumber ?: "–"}")
                state.par?.let { append(" · Par $it") }
                state.scoreVsPar?.let { append(" · $it") }
            },
            style = MaterialTheme.typography.caption2,
            color = MaterialTheme.colors.onSurfaceVariant
        )

        DistanceReadout(screen.distance)

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)
        ) {
            SmallButton(
                label = if (tracking) "Stop" else "Track",
                primary = tracking,
                // The at-course gate mirrors the phone's: off-course, recording
                // a shot is almost always an accident, and the phone would
                // refuse the write anyway.
                enabled = state.atCourse
            ) { model.toggleTracking(screen.fix) }

            SmallButton(label = "Shot", primary = true, enabled = state.atCourse) {
                model.recordShotHere(screen.fix, state.selectedClubId)
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally)
        ) {
            SmallButton(label = "◀", primary = false, enabled = true) { model.navigate(false) }
            // The club in hand, and the way to change it. Shown as the club's
            // own name rather than a generic "Club" so the golfer can confirm
            // at a glance what the next shot will be recorded against.
            SmallButton(
                label = screen.effectiveClub?.name ?: "Club",
                primary = false,
                enabled = screen.state.bag.isNotEmpty(),
                onClick = onPickClub
            )
            SmallButton(
                label = "Pin",
                primary = false,
                // Only with a fix — "set the flag where I'm standing" is
                // meaningless without knowing where that is, and writing a
                // guessed pin corrupts the shared hole for every other player.
                enabled = screen.fix != null
            ) { screen.fix?.let(model::setPin) }
            SmallButton(label = "▶", primary = false, enabled = true) { model.navigate(true) }
        }

        if (!state.atCourse) {
            Text(
                text = "Not at the course",
                style = MaterialTheme.typography.caption3,
                color = MaterialTheme.colors.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp)
            )
        }
    }
}

@Composable
private fun DistanceReadout(distance: Distance) {
    val (value, unit, fromWatch) = when (distance) {
        is Distance.Yards -> Triple(distance.value.toString(), "yards to pin", distance.fromWatch)
        is Distance.Feet -> Triple(distance.value.toString(), "feet to pin", distance.fromWatch)
        Distance.Unknown -> Triple("–", "no distance", false)
    }
    Text(text = value, style = MaterialTheme.typography.display1)
    Text(
        // Says whose number this is. A phone-sourced figure is a LAST KNOWN
        // value — the phone's JS is suspended in a pocket — and a golfer
        // deciding a club deserves to know the difference between that and a
        // live reading.
        text = if (fromWatch) unit else "$unit (phone)",
        style = MaterialTheme.typography.caption3,
        color = MaterialTheme.colors.onSurfaceVariant
    )
}

@Composable
private fun SmallButton(
    label: String,
    primary: Boolean,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Chip(
        onClick = onClick,
        enabled = enabled,
        label = {
            Text(
                text = label,
                style = MaterialTheme.typography.button,
                textAlign = TextAlign.Center
            )
        },
        colors = if (primary) ChipDefaults.primaryChipColors() else ChipDefaults.secondaryChipColors(),
        modifier = Modifier.size(width = 58.dp, height = 36.dp)
    )
}

/**
 * The resting screen. Offers practice, because it is the one thing the watch can
 * do entirely on its own — no round, no phone state, just the motion sensors.
 */
@Composable
private fun NoRound(onPractice: () -> Unit, onTempo: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp)
    ) {
        Text(
            text = "No round in progress",
            textAlign = TextAlign.Center,
            style = MaterialTheme.typography.body2,
            color = MaterialTheme.colors.onSurfaceVariant
        )
        Chip(
            onClick = onPractice,
            label = { Text("Practice", style = MaterialTheme.typography.button) },
            colors = ChipDefaults.primaryChipColors(),
            modifier = Modifier.padding(top = 10.dp)
        )
        Chip(
            onClick = onTempo,
            label = { Text("Tempo", style = MaterialTheme.typography.button) },
            colors = ChipDefaults.secondaryChipColors(),
            modifier = Modifier.padding(top = 6.dp)
        )
    }
}

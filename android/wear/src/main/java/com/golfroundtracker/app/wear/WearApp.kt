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
fun WearApp(model: RoundViewModel = viewModel()) {
    val screen by model.screen.collectAsStateWithLifecycle()
    val hasPermission by model.hasLocationPermission.collectAsStateWithLifecycle()
    val tracking by model.tracking.collectAsStateWithLifecycle()

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

    MaterialTheme {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            TimeText()
            when {
                !screen.heardFromPhone -> Message("Waiting for phone…")
                !screen.state.active -> Message("No round in progress")
                !hasPermission -> Message("Location off — open settings to let the watch measure")
                else -> RoundScreen(screen, tracking, model)
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
    model: RoundViewModel
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

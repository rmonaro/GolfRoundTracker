package com.golfroundtracker.app.wear

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

/**
 * Pick a club, on the wrist.
 *
 * PUTTERS ARE BUCKETED SEPARATELY, as they are on watchOS. Not decoration: the
 * putt view is gated on having a putter in hand, so "which of these is the
 * putter" is a question the UI has to answer at a glance rather than making the
 * golfer read a list of names on a 1.7" screen.
 *
 * A `ScalingLazyColumn`, not a plain column — it is the Wear idiom for a round
 * screen, shrinking items toward the edges so the one under the thumb is the
 * one in focus, and it takes rotary input for free.
 */
@Composable
fun ClubPickerScreen(
    bag: List<RoundState.Club>,
    selectedClubId: String?,
    onPick: (String) -> Unit
) {
    val putters = bag.filter { it.isPutter }
    val rest = bag.filterNot { it.isPutter }

    ScalingLazyColumn(modifier = Modifier.fillMaxWidth()) {
        if (rest.isNotEmpty()) {
            item { ListHeader { Text("Clubs", style = MaterialTheme.typography.caption1) } }
            items(rest) { club -> ClubRow(club, club.clubId == selectedClubId, onPick) }
        }
        if (putters.isNotEmpty()) {
            item { ListHeader { Text("Putter", style = MaterialTheme.typography.caption1) } }
            items(putters) { club -> ClubRow(club, club.clubId == selectedClubId, onPick) }
        }
        if (bag.isEmpty()) {
            item {
                Text(
                    // The bag rides along on every snapshot, so empty means the
                    // phone has not been heard from — not that the golfer owns
                    // no clubs.
                    text = "No clubs yet — waiting for the phone",
                    style = MaterialTheme.typography.caption2,
                    color = MaterialTheme.colors.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 12.dp)
                )
            }
        }
    }
}

@Composable
private fun ClubRow(
    club: RoundState.Club,
    selected: Boolean,
    onPick: (String) -> Unit
) {
    Chip(
        onClick = { onPick(club.clubId) },
        label = { Text(club.name, style = MaterialTheme.typography.button) },
        // The typical yardage is what makes this a choice rather than a list of
        // names — it is the number the golfer is matching against the distance
        // on the previous screen.
        secondaryLabel = club.typicalYards?.let {
            { Text("$it yds", style = MaterialTheme.typography.caption3) }
        },
        colors = if (selected) ChipDefaults.primaryChipColors() else ChipDefaults.secondaryChipColors(),
        modifier = Modifier.fillMaxWidth()
    )
}

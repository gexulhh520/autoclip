import { describe, expect, it } from 'vitest'
import { compileCompositionPlan } from '../compositor/compilePlan'
import { loadFixtureSession } from '../compositor/goldenFixtures'
import {
  flattenV3ToSession,
  hydrateEditDocument,
  migrateSessionToV3,
  normalizeEditDocument,
} from './v2ToV3'

const COMPILE_OPTS = { burnSubtitles: true, useSourceVideo: false }

describe('EditProjectV3 migration', () => {
  it('migrateSessionToV3 keeps clip placement stable across dissolve', () => {
    const session = loadFixtureSession('session-dissolve.json')
    const project = migrateSessionToV3(session)
    const main = project.scenes[0]?.tracks.main ?? []
    expect(main).toHaveLength(2)
    expect(main[1]?.start_time).toBeCloseTo(4, 2)
  })

  it('flattenV3ToSession roundtrip preserves sequence length', () => {
    const session = loadFixtureSession('session-minimal.json')
    const project = migrateSessionToV3(session)
    const restored = flattenV3ToSession(project)
    expect(restored.sequence).toHaveLength(session.sequence.length)
    expect(restored.sequence[0]?.id).toBe('a')
  })

  it('flattenV3ToSession roundtrip preserves video_transform and playback_rate', () => {
    const session = loadFixtureSession('session-minimal.json')
    session.sequence[0] = {
      ...session.sequence[0]!,
      playback_rate: 1.25,
      video_transform: {
        scale_x: 1.4,
        scale_y: 0.9,
        position_x: 12,
        position_y: -8,
      },
    }
    const project = migrateSessionToV3(session)
    expect(project.scenes[0]?.tracks.main[0]?.properties.playback_rate).toBe(1.25)
    expect(project.scenes[0]?.tracks.main[0]?.properties.video_transform).toEqual({
      scale_x: 1.4,
      scale_y: 0.9,
      position_x: 12,
      position_y: -8,
    })
    const restored = flattenV3ToSession(project)
    expect(restored.sequence[0]?.playback_rate).toBe(1.25)
    expect(restored.sequence[0]?.video_transform).toEqual({
      scale_x: 1.4,
      scale_y: 0.9,
      position_x: 12,
      position_y: -8,
    })
  })

  it('hydrateEditDocument merges video_transform from flat sequence when v3 lacks it', () => {
    const session = loadFixtureSession('session-minimal.json')
    const project = migrateSessionToV3(session)
    const stale = {
      ...session,
      schema_version: 3,
      project_v3: project,
      sequence: session.sequence.map((block) => ({
        ...block,
        video_transform: {
          scale_x: 2,
          scale_y: 2,
          position_x: 0,
          position_y: 0,
        },
      })),
    }
    const document = hydrateEditDocument(stale)
    expect(document.session.sequence[0]?.video_transform?.scale_x).toBe(2)
  })

  it('normalizeEditDocument compiles same plan duration as session', () => {
    const session = loadFixtureSession('session-dissolve.json')
    const direct = compileCompositionPlan(session, COMPILE_OPTS)
    const document = normalizeEditDocument(session)
    const viaProject = compileCompositionPlan(flattenV3ToSession(document.project), COMPILE_OPTS)
    expect(viaProject.totalDurationSec).toBeCloseTo(direct.totalDurationSec, 2)
  })

  it('hydrateEditDocument prefers flat sequence when project_v3 is stale after append', () => {
    const session = loadFixtureSession('session-minimal.json')
    const project = migrateSessionToV3(session)
    const appended = {
      ...session.sequence[0]!,
      id: 'block-new',
      source_clip_id: 'clip-new',
      title: '新追加片段',
    }
    const stale = {
      ...session,
      schema_version: 3,
      project_v3: project,
      sequence: [...session.sequence, appended],
    }
    const document = hydrateEditDocument(stale)
    expect(document.session.sequence).toHaveLength(2)
    expect(document.session.sequence[1]?.id).toBe('block-new')
    expect(document.session.sequence[1]?.title).toBe('新追加片段')
  })

  it('hydrateEditDocument prefers project_v3 over stale flat sequence', () => {
    const session = loadFixtureSession('session-minimal.json')
    const project = migrateSessionToV3(session)
    project.scenes[0]!.tracks.main[0]!.properties.title = 'from-v3'
    const stale = {
      ...session,
      schema_version: 3,
      project_v3: project,
      sequence: session.sequence.map((block) => ({ ...block, title: 'stale-flat' })),
    }
    const document = hydrateEditDocument(stale)
    expect(document.session.sequence[0]?.title).toBe('from-v3')
    expect(document.project.scenes[0]?.tracks.main[0]?.properties.title).toBe('from-v3')
  })

  it('hydrateEditDocument prefers flat overlay_elements over stale project_v3', () => {
    const session = loadFixtureSession('session-free-text.json')
    const project = migrateSessionToV3(session)
    const staleParams = { ...(session.overlay_elements?.[0]?.params ?? {}), fontSize: 99 }
    const stale = {
      ...session,
      schema_version: 3,
      project_v3: project,
      overlay_elements: [{ ...session.overlay_elements![0]!, params: staleParams }],
    }
    const document = hydrateEditDocument(stale)
    expect(document.session.overlay_elements?.[0]?.params.fontSize).toBe(99)
    expect(
      document.project.scenes[0]?.tracks.overlay.find((item) => item.id === 'txt-1')?.properties
        .params?.fontSize
    ).toBe(99)
  })

  it('roundtrips overlay video track placement through project_v3 and hydrate', () => {
    const session = loadFixtureSession('session-minimal.json')
    const overlayTrackId = 'overlay-track-1'
    const moved = {
      ...session.sequence[0]!,
      track_id: overlayTrackId,
      timeline_start_sec: 3.5,
    }
    const withTracks = {
      ...session,
      sequence: [moved],
      video_tracks: [
        { id: 'default-video', name: 'Video', order: 0, hidden: false },
        { id: overlayTrackId, name: 'Video 2', order: 1, hidden: false },
      ],
    }
    const project = migrateSessionToV3(withTracks)
    expect(project.scenes[0]?.tracks.main).toHaveLength(0)
    expect(project.scenes[0]?.tracks.video_overlays).toHaveLength(1)
    expect(project.scenes[0]?.tracks.video_overlays?.[0]?.start_time).toBeCloseTo(3.5, 2)
    expect(project.scenes[0]?.tracks.video_overlays?.[0]?.properties.track_id).toBe(overlayTrackId)

    const restored = flattenV3ToSession(project)
    expect(restored.sequence[0]?.track_id).toBe(overlayTrackId)
    expect(restored.sequence[0]?.timeline_start_sec).toBeCloseTo(3.5, 2)

    const staleProject = migrateSessionToV3({
      ...withTracks,
      sequence: withTracks.sequence.map((block) => ({
        ...block,
        track_id: 'default-video',
      })),
    })
    const hydrated = hydrateEditDocument({
      ...withTracks,
      schema_version: 3,
      project_v3: staleProject,
    })
    expect(hydrated.session.sequence[0]?.track_id).toBe(overlayTrackId)
    expect(hydrated.session.sequence[0]?.timeline_start_sec).toBeCloseTo(3.5, 2)
    expect(hydrated.session.video_tracks).toHaveLength(2)
  })
})

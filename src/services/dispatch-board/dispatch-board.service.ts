import { Injectable } from '@nestjs/common'
import { ConfigDomainService } from 'src/domains/config/config.domain.service'
import { DeliveryDomainService } from 'src/domains/delivery/delivery.domain.service'
import { DeliveryIssueRepository } from 'src/persistence/repositories/delivery-issue.repository'
import { DispatchBoardRepository } from 'src/persistence/repositories/dispatch-board.repository'
import { DispatchStopService } from 'src/services/dispatch-stop/dispatch-stop.service'
import { SosService } from 'src/services/sos/sos.service'
import {
  AttentionRow,
  buildCards,
  buildMap,
  DispatchBoardCards,
  DispatchMap,
  offerUnansweredRows,
  orderAttentionRows,
  restaurantLateRows,
  riderReportRows,
  sosRows,
  todayBounds,
  waitingForRiderRows,
} from './dispatch-board'

export type DispatchBoard = {
  generatedAt: Date
  cards: DispatchBoardCards
  attention: AttentionRow[]
  attentionMore: number
  map: DispatchMap
  dispatchStop: { active: boolean; until: Date | null }
}

// The admin Dispatch board (spec 0034): one answer, asked for every 10 s. A new kind of row is one
// more function in `dispatch-board.ts` and one more line in the list below.
@Injectable()
export class DispatchBoardService {
  constructor(
    private readonly dispatchBoardRepository: DispatchBoardRepository,
    private readonly deliveryIssueRepository: DeliveryIssueRepository,
    private readonly deliveryDomainService: DeliveryDomainService,
    private readonly sosService: SosService,
    private readonly dispatchStopService: DispatchStopService,
    private readonly configDomainService: ConfigDomainService
  ) {}

  async getBoard(now: Date = new Date()): Promise<DispatchBoard> {
    const { start, end } = todayBounds(now)
    const [live, couriers, delivered, issues, incidents, stop, offerTimingEnabled] = await Promise.all([
      this.dispatchBoardRepository.findLiveDeliveries(),
      this.dispatchBoardRepository.findWorkingCouriers(),
      this.dispatchBoardRepository.findDroppedOffBetween(start, end),
      this.deliveryIssueRepository.findOpen(),
      this.sosService.listCurrent(),
      this.dispatchStopService.adminOverview(now),
      this.configDomainService.instanceConfig.getOfferTimingEnabled(),
    ])
    const offerViews = await this.deliveryDomainService.getOfferViews(live)

    const { attention, attentionMore } = orderAttentionRows([
      ...sosRows(incidents),
      ...waitingForRiderRows(live, offerViews, offerTimingEnabled, now),
      ...offerUnansweredRows(live, offerViews),
      ...restaurantLateRows(live, now),
      ...riderReportRows(issues),
    ])

    return {
      generatedAt: now,
      cards: buildCards(live, couriers, delivered, now),
      attention,
      attentionMore,
      map: buildMap(live, couriers),
      dispatchStop: { active: stop.current !== null, until: stop.current?.endsAt ?? null },
    }
  }
}

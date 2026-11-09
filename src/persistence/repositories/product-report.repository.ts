import { Injectable } from '@nestjs/common'
import { EnumProductReportKind, EnumProductReportSource, Prisma, ProductReport } from '@prisma/types'
import { createPaginator } from '../../rest-api/Paginator'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'

export type ProductReportState = 'open' | 'resolved' | 'all'

export type ProductReportWithReporter = ProductReport & { reporterEmail: string | null }

@Injectable()
export class ProductReportRepository extends EntityRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(data: {
    deliveryId: string
    kind: EnumProductReportKind
    source: EnumProductReportSource
    reporterUserId: string
    itemName: string | null
    note: string | null
  }): Promise<ProductReport> {
    return this.prisma.productReport.create({ data })
  }

  async findById(id: string): Promise<ProductReport | null> {
    return this.prisma.productReport.findUnique({ where: { id } })
  }

  async findForDelivery(deliveryId: string): Promise<ProductReportWithReporter[]> {
    const rows = await this.prisma.productReport.findMany({ where: { deliveryId }, orderBy: { createdAt: 'desc' } })
    return this.withReporters(rows)
  }

  async findPage(state: ProductReportState, page?: number, perPage?: number) {
    const where: Prisma.ProductReportWhereInput =
      state === 'all' ? {} : { resolvedAt: state === 'open' ? null : { not: null } }
    const paginator = createPaginator<ProductReport, Prisma.ProductReportFindManyArgs, Prisma.ProductReportDelegate>()
    const result = await paginator(this.prisma.productReport, { where, orderBy: { createdAt: 'desc' } }, { page, perPage })
    return { data: await this.withReporters(result.data), pagination: result.pagination }
  }

  // Sets the resolution once. A report already resolved is left as it is (spec 0032, AC-7).
  async resolveIfOpen(id: string, resolvedByUserId: string, resolution: string | null): Promise<boolean> {
    const changed = await this.prisma.productReport.updateMany({
      where: { id, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedByUserId, resolution },
    })
    return changed.count === 1
  }

  private async withReporters(rows: ProductReport[]): Promise<ProductReportWithReporter[]> {
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.reporterUserId))] } },
      select: { id: true, email: true },
    })
    const emailOf = new Map(users.map((user) => [user.id, user.email]))
    return rows.map((row) => ({ ...row, reporterEmail: emailOf.get(row.reporterUserId) ?? null }))
  }
}

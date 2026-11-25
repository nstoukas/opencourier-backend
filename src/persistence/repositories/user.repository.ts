import { Injectable } from '@nestjs/common'
import { Prisma, User } from '@prisma/types'
import { Language } from 'src/localization/translate'
import { assign } from 'lodash'
import { UserEntity } from '../../domains/user/entities/user.entity'
import { IUserRepository } from '../../domains/user/interfaces/IUserRepository'
import { PrismaService } from '../../services/prisma/prisma.service'
import { EntityRepository } from '../EntityRepository'
import { Exact } from 'src/types'
import { IUserUpdate } from 'src/domains/user/interfaces/IUserUpdate'
import { IUserCreate } from 'src/domains/user/interfaces/IUserCreate'

@Injectable()
export class UserRepository extends EntityRepository implements IUserRepository {
  constructor(prisma: PrismaService) {
    super(prisma)
  }

  async create(data: Exact<IUserCreate>) {
    const result = await this.prisma.user.create({
      data: {
        ...data,
      },
    })
    return this.toDomain(result)
  }

  async findById(userId: string) {
    const result = await this.prisma.user.findUniqueOrThrow({
      where: {
        id: userId,
      },
    })
    return this.toDomain(result)
  }

  // The one key lookup (spec 0037): by the hash of the sent key, never the key itself. The column is
  // unique, so `findUnique` reads at most one row through its index.
  async findByApiKeyHash(apiKeyHash: string) {
    const result = await this.prisma.user.findUnique({
      where: { apiKeyHash },
    })
    return result ? this.toDomain(result) : null
  }

  // An admin's New API key (spec 0037): the hash and its time are always written together. Answers
  // whether a key was there before, for the log line. The first write only matches a login that has a
  // key; if it matched nothing, the second gives the login its first key. No read before the write.
  // A Remove landing between the two writes is overwritten by the new key: the last admin action wins,
  // as spec 0037 accepts (the admin did ask for a new key). Both writes clear row 162's reset note: the page
  // then shows the key, not why an older one went.
  async replaceApiKeyHash(userId: string, apiKeyHash: string, apiKeyCreatedAt: Date): Promise<{ replaced: boolean }> {
    const replaced = await this.prisma.user.updateMany({
      where: { id: userId, apiKeyHash: { not: null } },
      data: { apiKeyHash, apiKeyCreatedAt, apiKeyRemovedByResetAt: null },
    })
    if (replaced.count > 0) {
      return { replaced: true }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { apiKeyHash, apiKeyCreatedAt, apiKeyRemovedByResetAt: null },
    })
    return { replaced: false }
  }

  // An admin's Remove key (spec 0037). Answers whether there was a key to remove, for the log line.
  // An admin's removal is not the reset's, so it clears row 162's note. With no key it matches nothing, and a
  // reset's note (still the reason there is no key) stays.
  async removeApiKey(userId: string): Promise<{ removed: boolean }> {
    const result = await this.prisma.user.updateMany({
      where: { id: userId, apiKeyHash: { not: null } },
      data: { apiKeyHash: null, apiKeyCreatedAt: null, apiKeyRemovedByResetAt: null },
    })
    return { removed: result.count > 0 }
  }

  // Row 153: a restaurant's own reset by emailed code. The password, the time older sessions stop
  // working, and the API key switched off (row 110's rule: whoever had the old password loses the key too).
  // No new key: only an admin makes one, shown once to them (spec 0037). Answers whether a key was removed.
  async setPasswordAndRemoveApiKey(
    userId: string,
    password: string,
    credentialsChangedAt: Date
  ): Promise<{ apiKeyRemoved: boolean }> {
    // One transaction, like setPasswordAndReplaceApiKey below: the key is switched off only where one exists,
    // and the count says whether it was. Only then is the time noted for the admin page (row 162): a reset of a
    // login with no key leaves the note as it was.
    const [, keyWrite] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password, credentialsChangedAt },
      }),
      this.prisma.user.updateMany({
        where: { id: userId, apiKeyHash: { not: null } },
        data: { apiKeyHash: null, apiKeyCreatedAt: null, apiKeyRemovedByResetAt: credentialsChangedAt },
      }),
    ])
    return { apiKeyRemoved: keyWrite.count > 0 }
  }

  // An admin's Set New Password (specs 0013 and 0037). One database transaction (both writes land or
  // neither does): the password and its time, then the key replaced only where one exists. So the new
  // password never works beside the old key, and a Remove made at the same moment is never undone:
  // whichever lands second sees the other's result. Answers whether the new key was stored.
  async setPasswordAndReplaceApiKey(
    userId: string,
    password: string,
    credentialsChangedAt: Date,
    apiKeyHash: string
  ): Promise<{ apiKeyReplaced: boolean }> {
    const [, keyWrite] = await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { password, credentialsChangedAt },
      }),
      this.prisma.user.updateMany({
        where: { id: userId, apiKeyHash: { not: null } },
        data: { apiKeyHash, apiKeyCreatedAt: credentialsChangedAt, apiKeyRemovedByResetAt: null },
      }),
    ])
    return { apiKeyReplaced: keyWrite.count > 0 }
  }

  async findByIdWithCourier(userId: string) {
    const result = await this.prisma.user.findUniqueOrThrow({
      where: {
        id: userId,
      },
      include: {
        courier: true,
      },
    })
    return assign(this.toDomain(result))
  }

  async findUserWithEmail(email: string) {
    const result = await this.prisma.user.findUnique({
      where: {
        email,
      },
    })
    return result ? this.toDomain(result) : undefined
  }

  // Any account with this email, whatever its capitals (spec 0013): stored emails may predate the
  // lower casing, and "Nikos@x.gr" and "nikos@x.gr" must not become two logins.
  async findUserWithEmailIgnoringCase(email: string) {
    const result = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    })
    return result ? this.toDomain(result) : undefined
  }

  async findByEmail(email: string) {
    const result = await this.prisma.user.findUniqueOrThrow({
      where: {
        email,
      },
    })
    return this.toDomain(result)
  }

  async findByUsername(username: string) {
    const result = await this.prisma.user.findUnique({
      where: {
        username,
      },
    })
    if (!result) {
      throw new Error('No User found')
    }
    return this.toDomain(result)
  }

  findByCustomerPhone(number: string) {
    throw new Error('Not implemented')
  }

  findByGroupId(groupId: string) {
    throw new Error('Not implemented')
  }

  async updateById(userId: string, data: Exact<IUserUpdate>) {
    const result = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        ...data,
      },
      include: {
        courier: true,
      },
    })

    return assign(this.toDomain(result))
  }

  // Spec 0054 (AC-1, AC-2): the language a person chose. Only this column, nothing else from a request.
  // The data goes through a plain record because the generated client learns the column only at the
  // `prisma generate` after its migration; until then the typed input has no `language` field.
  async setLanguage(userId: string, language: Language): Promise<void> {
    const data: Record<string, unknown> = { language }
    await this.prisma.user.update({ where: { id: userId }, data: data as Prisma.UserUpdateInput, select: { id: true } })
  }

  async deleteById(userId: string) {
    const result = await this.prisma.user.delete({
      where: {
        id: userId,
      },
    })
    return this.toDomain(result)
  }

  async countAll() {
    return this.prisma.user.count()
  }

  private toDomain(data: User) {
    return new UserEntity(data)
  }

  private toDomainMany(data: User[]) {
    return data.map((d) => this.toDomain(d))
  }
}

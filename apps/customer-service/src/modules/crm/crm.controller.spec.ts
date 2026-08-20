import { Test } from '@nestjs/testing';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';

describe('CrmController', () => {
  let controller: CrmController;
  const service = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [CrmController],
      providers: [{ provide: CrmService, useValue: service }],
    }).compile();
    controller = moduleRef.get(CrmController);
  });

  it('findAll delegates', async () => {
    service.findAll.mockResolvedValue([{ id: 'c1' }]);
    expect(await controller.findAll()).toEqual([{ id: 'c1' }]);
  });

  it('findOne delegates', async () => {
    service.findOne.mockResolvedValue({ id: 'c1' });
    expect(await controller.findOne('c1')).toEqual({ id: 'c1' });
  });

  it('create delegates', async () => {
    service.create.mockResolvedValue({ id: 'c1' });
    expect(await controller.create({ subscriberId: 's1', documentUrl: 'http://x' })).toEqual({ id: 'c1' });
  });

  it('update delegates', async () => {
    service.update.mockResolvedValue({ id: 'c1' });
    expect(await controller.update('c1', { documentUrl: 'http://y' })).toEqual({ id: 'c1' });
  });
});
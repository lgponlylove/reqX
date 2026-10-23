import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../../stores/app';
import { renderRequestDocs } from '../api-docs';
import type { ApiRequest } from '../../types/api';

describe('Auto Response Examples for Documentation', () => {
  beforeEach(() => {
    useAppStore.setState({
      requests: {},
      collections: [],
    });
  });

  it('addResponseExample deduplicates same status code and allows new ones', () => {
    const reqId = 'req-test-1';
    const initialReq: ApiRequest = {
      id: reqId,
      name: 'Get User',
      method: 'GET',
      url: 'https://api.example.com/users/1',
      headers: [],
      params: [],
      bodyType: 'none',
      body: '',
      auth: { type: 'none' },
      updatedAt: Date.now(),
    };

    useAppStore.setState({
      requests: { [reqId]: initialReq },
    });

    // Thêm response 200 lần đầu -> thành công
    const added200 = useAppStore.getState().addResponseExample(reqId, {
      id: 'exp-1',
      status: 200,
      statusText: 'OK',
      body: '{"id": 1, "name": "Alice"}',
      savedAt: Date.now(),
      timeMs: 45,
    });
    expect(added200).toBe(true);
    expect(useAppStore.getState().requests[reqId].examples?.length).toBe(1);

    // Gửi lại ra tiếp 200 -> đã có rồi nên bỏ qua (trả về false)
    const added200Again = useAppStore.getState().addResponseExample(reqId, {
      id: 'exp-2',
      status: 200,
      statusText: 'OK',
      body: '{"id": 1, "name": "Alice updated"}',
      savedAt: Date.now(),
      timeMs: 40,
    });
    expect(added200Again).toBe(false);
    expect(useAppStore.getState().requests[reqId].examples?.length).toBe(1);

    // Gửi ra lỗi 404 -> status code mới -> tự động lưu thêm
    const added404 = useAppStore.getState().addResponseExample(reqId, {
      id: 'exp-3',
      status: 404,
      statusText: 'Not Found',
      body: '{"error": "User not found"}',
      savedAt: Date.now(),
      timeMs: 30,
    });
    expect(added404).toBe(true);
    expect(useAppStore.getState().requests[reqId].examples?.length).toBe(2);

    // Thêm tiếp lỗi 500
    const added500 = useAppStore.getState().addResponseExample(reqId, {
      id: 'exp-4',
      status: 500,
      statusText: 'Internal Server Error',
      body: '{"error": "DB crash"}',
      savedAt: Date.now(),
      timeMs: 120,
    });
    expect(added500).toBe(true);
    expect(useAppStore.getState().requests[reqId].examples?.length).toBe(3);
  });

  it('renders saved examples in markdown documentation', () => {
    const req: ApiRequest = {
      id: 'req-doc-1',
      name: 'Create Order',
      method: 'POST',
      url: 'https://api.example.com/orders',
      headers: [],
      params: [],
      bodyType: 'json',
      body: '{"item": "book"}',
      auth: { type: 'none' },
      updatedAt: Date.now(),
      examples: [
        {
          id: 'exp-201',
          status: 201,
          statusText: 'Created',
          body: '{"orderId": "ORD-123", "status": "created"}',
          savedAt: Date.now(),
        },
        {
          id: 'exp-400',
          status: 400,
          statusText: 'Bad Request',
          body: '{"message": "Item is out of stock"}',
          savedAt: Date.now(),
        },
      ],
    };

    const docVi = renderRequestDocs(req, { lang: 'vi' });
    expect(docVi).toContain('201');
    expect(docVi).toContain('ORD-123');
    expect(docVi).toContain('Phản hồi lỗi 400 (Bad Request)');
    expect(docVi).toContain('Item is out of stock');

    const docEn = renderRequestDocs(req, { lang: 'en' });
    expect(docEn).toContain('Response Error 400 (Bad Request)');
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { publicEquipment, publicLoan, publicOccurrence } from '../src/lib/publicDto.js';

test('Guest equipment DTO contains only operational dashboard fields', () => {
  const dto = publicEquipment({
    id: 1, modelo: 'Tablet', categoriaId: 4, quantidadeTotal: 10,
    quantidadeDisponivel: 8, quantidadeQuebrada: 1,
    createdAt: new Date(), updatedAt: new Date(),
    categoria: { id: 4, nome: 'Informática' },
  });
  assert.deepEqual(Object.keys(dto).sort(), ['categoria', 'id', 'modelo', 'quantidadeDisponivel', 'quantidadeQuebrada', 'quantidadeTotal'].sort());
  assert.deepEqual(Object.keys(dto.categoria!).sort(), ['id', 'nome']);
});

test('Guest loan DTO omits personal names and free-text observations', () => {
  const dto = publicLoan({
    id: 12, solicitanteNome: 'Pessoa sintética', responsavelId: 2,
    status: 'ABERTO', dataRetirada: new Date(), dataDevolucao: null,
    observacao: 'nota privada', createdAt: new Date(),
    responsavel: { id: 2, nome: 'Funcionário', cargo: 'Coordenação' },
    itens: [{
      id: 20, emprestimoId: 12, equipamentoId: 1, quantidade: 1,
      equipamento: { id: 1, categoriaId: 4, modelo: 'Tablet', quantidadeTotal: 10, quantidadeDisponivel: 8, quantidadeQuebrada: 1,
        createdAt: new Date(), updatedAt: new Date(), categoria: { id: 4, nome: 'Informática' } },
    }],
  });
  assert.equal(dto.solicitanteNome, 'Convidado');
  assert.equal(dto.observacao, null);
  assert.equal(dto.responsavel, null);
  assert.equal(dto.responsavelId, null);
  assert.equal(dto.itens[0].equipamento?.modelo, 'Tablet');
  assert.equal(JSON.stringify(dto).includes('Pessoa sintética'), false);
  assert.equal(JSON.stringify(dto).includes('nota privada'), false);
  assert.equal(JSON.stringify(dto).includes('Funcionário'), false);
});

test('Guest occurrence DTO withholds free text, serial number and remediation notes', () => {
  const dto = publicOccurrence({
    id: 8, equipamentoId: 1, numero: 'SERIAL-PRIVATE', tipo: 'MANUTENCAO', status: 'ABERTO',
    problema: 'problema privado', descricao: 'detalhe privado', resolvidoEm: null,
    medidasTomadas: 'nota privada', createdAt: new Date(),
    equipamento: { id: 1, categoriaId: 4, modelo: 'Tablet', quantidadeTotal: 10, quantidadeDisponivel: 8, quantidadeQuebrada: 1,
      createdAt: new Date(), updatedAt: new Date(), categoria: { id: 4, nome: 'Informática' } },
  });
  assert.equal(dto.numero, null);
  assert.equal(dto.problema, 'Detalhes restritos');
  assert.equal(dto.descricao, '');
  assert.equal(dto.medidasTomadas, null);
  assert.equal(JSON.stringify(dto).includes('SERIAL-PRIVATE'), false);
  assert.equal(JSON.stringify(dto).includes('problema privado'), false);
  assert.equal(JSON.stringify(dto).includes('nota privada'), false);
});
